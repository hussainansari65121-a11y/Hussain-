import type {
  CalendarEventItem,
  ContactItem,
} from "../types/workspace";

export class WorkspaceAuthExpiredError extends Error {
  constructor(message = "Google Workspace session expired. Please sign in again.") {
    super(message);
    this.name = "WorkspaceAuthExpiredError";
  }
}

async function workspaceFetch<T>(
  url: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new WorkspaceAuthExpiredError();
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    let message = `Workspace request failed (${response.status})`;
    try {
      const parsed = JSON.parse(errText);
      if (parsed?.error?.message) message = parsed.error.message;
    } catch {
      if (errText) message = errText;
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

// --- Google Calendar API (calendar.events) ---

export async function listCalendarEvents(
  accessToken: string,
  query?: string
): Promise<CalendarEventItem[]> {
  const nowIso = new Date().toISOString();
  const params = new URLSearchParams({
    timeMin: nowIso,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "25",
  });

  if (query && query.trim()) {
    params.set("q", query.trim());
  }

  const data = await workspaceFetch<{ items?: CalendarEventItem[] }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    accessToken
  );

  return data.items || [];
}

export async function createCalendarEvent(
  accessToken: string,
  input: {
    summary: string;
    description?: string;
    location?: string;
    startDateTime: string;
    endDateTime: string;
  }
): Promise<CalendarEventItem> {
  return workspaceFetch<CalendarEventItem>(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        summary: input.summary,
        description: input.description || undefined,
        location: input.location || undefined,
        start: {
          dateTime: new Date(input.startDateTime).toISOString(),
        },
        end: {
          dateTime: new Date(input.endDateTime).toISOString(),
        },
      }),
    }
  );
}

export async function updateCalendarEvent(
  accessToken: string,
  eventId: string,
  input: {
    summary: string;
    description?: string;
    location?: string;
    startDateTime?: string;
    endDateTime?: string;
  }
): Promise<CalendarEventItem> {
  const payload: Record<string, unknown> = {
    summary: input.summary,
    description: input.description ?? "",
    location: input.location ?? "",
  };
  if (input.startDateTime && input.endDateTime) {
    payload.start = { dateTime: new Date(input.startDateTime).toISOString() };
    payload.end = { dateTime: new Date(input.endDateTime).toISOString() };
  }

  return workspaceFetch<CalendarEventItem>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    accessToken,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    }
  );
}

export async function deleteCalendarEvent(
  accessToken: string,
  eventId: string
): Promise<void> {
  await workspaceFetch<void>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    accessToken,
    {
      method: "DELETE",
    }
  );
}

// --- Google Contacts / People API (contacts.readonly) ---

interface RawPerson {
  resourceName?: string;
  names?: Array<{ displayName?: string }>;
  emailAddresses?: Array<{ value?: string }>;
  phoneNumbers?: Array<{ value?: string }>;
  organizations?: Array<{ name?: string; title?: string }>;
  photos?: Array<{ url?: string }>;
}

function mapPersonToContact(person: RawPerson): ContactItem | null {
  const displayName =
    person.names?.[0]?.displayName ||
    person.emailAddresses?.[0]?.value ||
    person.phoneNumbers?.[0]?.value;
  if (!displayName) return null;

  const org = person.organizations?.[0];
  const orgLabel = [org?.title, org?.name].filter(Boolean).join(" · ");

  return {
    resourceName: person.resourceName || displayName,
    displayName,
    email: person.emailAddresses?.[0]?.value,
    phone: person.phoneNumbers?.[0]?.value,
    organization: orgLabel || undefined,
    photoUrl: person.photos?.[0]?.url,
  };
}

export async function listContacts(
  accessToken: string,
  query?: string
): Promise<ContactItem[]> {
  const trimmed = (query || "").trim();

  if (trimmed) {
    const params = new URLSearchParams({
      query: trimmed,
      readMask: "names,emailAddresses,phoneNumbers,photos,organizations",
      pageSize: "25",
    });
    const data = await workspaceFetch<{
      results?: Array<{ person?: RawPerson }>;
    }>(
      `https://people.googleapis.com/v1/people:searchContacts?${params.toString()}`,
      accessToken
    );
    return (data.results || [])
      .map((r) => (r.person ? mapPersonToContact(r.person) : null))
      .filter((c): c is ContactItem => c !== null);
  }

  const params = new URLSearchParams({
    personFields: "names,emailAddresses,phoneNumbers,photos,organizations",
    pageSize: "30",
    sortOrder: "FIRST_NAME_ASCENDING",
  });

  const data = await workspaceFetch<{ connections?: RawPerson[] }>(
    `https://people.googleapis.com/v1/people/me/connections?${params.toString()}`,
    accessToken
  );

  return (data.connections || [])
    .map(mapPersonToContact)
    .filter((c): c is ContactItem => c !== null);
}
