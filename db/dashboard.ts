import { salonDate } from '../core/booking.ts';

export function commercialPeriod(now = new Date()) {
  const today = salonDate(now.toISOString());
  const start = new Date(today + 'T00:00:00-03:00');
  const week = new Date(start);
  week.setUTCDate(week.getUTCDate() - ((week.getUTCDay() + 6) % 7));
  return {
    today: start.toISOString(),
    week: week.toISOString(),
    now: now.toISOString(),
  };
}
export async function commercialDashboard(db: D1Database, now = new Date()) {
  const period = commercialPeriod(now);
  const cte = `WITH leads AS (
    SELECT c.id, cl.lead_source, MIN(m.created_at) AS first_inbound
    FROM conversations c JOIN clients cl ON cl.id = c.client_id JOIN messages m ON m.conversation_id = c.id
    WHERE c.channel = 'WHATSAPP' AND m.direction = 'INBOUND' GROUP BY c.id)`;
  const cohort = await db
    .prepare(`${cte} SELECT
    COUNT(*) AS leads_week,
    COALESCE(SUM(first_inbound >= ?),0) AS leads_today,
    COALESCE(SUM(EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id = leads.id AND m.direction = 'OUTBOUND' AND m.status IN ('sent','delivered','read'))),0) AS leads_served,
    COALESCE(SUM(EXISTS(SELECT 1 FROM appointments a WHERE a.conversation_id = leads.id AND a.status IN ('CONFIRMED','COMPLETED'))),0) AS converted_leads
    FROM leads WHERE first_inbound >= ? AND first_inbound <= ?`)
    .bind(period.today, period.week, period.now)
    .first<{
      leads_week: number;
      leads_today: number;
      leads_served: number;
      converted_leads: number;
    }>();
  const sources = await db
    .prepare(`${cte} SELECT lead_source, COUNT(*) AS leads,
    SUM(EXISTS(SELECT 1 FROM appointments a WHERE a.conversation_id = leads.id AND a.status IN ('CONFIRMED','COMPLETED'))) AS booked_leads,
    SUM((SELECT estimated_value_cents FROM opportunities o WHERE o.conversation_id = leads.id AND o.stage NOT IN ('BOOKED','ATTENDED','LOST'))) AS potential_cents,
    SUM((SELECT SUM(estimated_value_cents) FROM appointments a WHERE a.conversation_id = leads.id AND a.status IN ('CONFIRMED','COMPLETED'))) AS booked_cents
    FROM leads WHERE first_inbound >= ? AND first_inbound <= ? GROUP BY lead_source ORDER BY leads DESC`)
    .bind(period.week, period.now)
    .all();
  const operational = await db
    .prepare(`SELECT
    (SELECT COUNT(*) FROM conversations c LEFT JOIN opportunities o ON o.conversation_id = c.id WHERE c.channel = 'WHATSAPP' AND COALESCE(o.stage,'NEW_LEAD') NOT IN ('BOOKED','ATTENDED','LOST')) AS active_conversations,
    (SELECT COUNT(*) FROM follow_ups f JOIN conversations c ON c.id = f.conversation_id WHERE c.channel = 'WHATSAPP' AND f.status IN ('SCHEDULED','WAITING_FOR_TEMPLATE','PROCESSING')) AS pending_follow_ups,
    (SELECT COUNT(DISTINCT f.conversation_id) FROM follow_ups f JOIN conversations c ON c.id = f.conversation_id WHERE c.channel = 'WHATSAPP' AND f.recovered_at >= ?) AS recovered_leads,
    (SELECT SUM(o.estimated_value_cents) FROM opportunities o JOIN conversations c ON c.id = o.conversation_id WHERE c.channel = 'WHATSAPP' AND o.stage NOT IN ('BOOKED','ATTENDED','LOST')) AS potential_cents,
    (SELECT COUNT(*) FROM appointments a JOIN conversations c ON c.id = a.conversation_id WHERE c.channel = 'WHATSAPP' AND a.status = 'CONFIRMED' AND a.start_at >= ?) AS future_bookings,
    (SELECT SUM(a.estimated_value_cents) FROM appointments a JOIN conversations c ON c.id = a.conversation_id WHERE c.channel = 'WHATSAPP' AND a.status = 'CONFIRMED' AND a.start_at >= ?) AS forecast_cents,
    (SELECT COUNT(*) FROM appointments a JOIN conversations c ON c.id = a.conversation_id WHERE c.channel = 'WHATSAPP' AND a.status = 'CONFIRMED' AND a.start_at >= ? AND a.estimated_value_cents IS NULL) AS bookings_without_value`)
    .bind(period.week, period.now, period.now, period.now)
    .first<{
      active_conversations: number;
      pending_follow_ups: number;
      recovered_leads: number;
      potential_cents: number | null;
      future_bookings: number;
      forecast_cents: number | null;
      bookings_without_value: number;
    }>();
  return {
    period,
    ...cohort,
    ...operational,
    conversion_rate: cohort?.leads_week
      ? Math.round((cohort.converted_leads / cohort.leads_week) * 1000) / 10
      : 0,
    sources: sources.results,
  };
}
