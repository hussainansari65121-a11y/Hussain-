export type WorkspaceTab = "calendar" | "contacts";

export interface WorkspaceCommandPayload {
  tab: WorkspaceTab;
  query?: string;
}

export interface CalendarEventItem {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: {
    dateTime?: string;
    date?: string;
  };
  end?: {
    dateTime?: string;
    date?: string;
  };
}

export interface ContactItem {
  resourceName: string;
  displayName: string;
  email?: string;
  phone?: string;
  organization?: string;
  photoUrl?: string;
}
