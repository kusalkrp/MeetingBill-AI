import { getCalendarClient } from './auth';

export interface CalendarEvent {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  attendees: { email: string; responseStatus: string }[];
  organizerEmail: string | null;
}

export async function fetchRecentlyEndedMeetings(workspaceId: string): Promise<CalendarEvent[]> {
  const calendar = await getCalendarClient(workspaceId);
  
  const now = new Date();
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

  // T4.4: Exclude descriptions/attachments intentionally for privacy reasons
  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: fiveMinutesAgo.toISOString(),
    timeMax: now.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    fields: 'items(id,summary,start,end,attendees,organizer)' 
  });

  const parsedEvents: CalendarEvent[] = [];
  const items = response.data.items || [];

  for (const item of items) {
    // Only process meetings with more than 1 attendee
    if (!item.attendees || item.attendees.length <= 1) continue;
    
    // Safety check for explicitly scheduled times
    if (!item.start?.dateTime || !item.end?.dateTime) continue;

    const startTime = new Date(item.start.dateTime);
    const endTime = new Date(item.end.dateTime);
    const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000);

    const attendees = item.attendees.map(a => ({
      email: a.email || '',
      responseStatus: a.responseStatus || 'unknown'
    }));

    parsedEvents.push({
      id: item.id || 'unknown',
      title: item.summary || 'Untitled Event',
      startTime,
      endTime,
      durationMinutes,
      attendees,
      organizerEmail: item.organizer?.email || null
    });
  }

  return parsedEvents;
}
