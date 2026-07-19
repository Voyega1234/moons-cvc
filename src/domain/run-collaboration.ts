export const teamDepartments = [
  "cs",
  "gd",
  "pm",
  "admin",
  "unassigned"
] as const;

export type TeamDepartment = (typeof teamDepartments)[number];

export interface TeamMember {
  userId: string;
  email: string;
  displayName: string;
  department: TeamDepartment;
  isAdmin: boolean;
}

export interface RunOwnership {
  workspaceRunId: string;
  currentOwnerUserId: string;
  version: number;
  status: "active" | "completed" | "archived";
  updatedAt: string;
}

export const clientMembershipRoles = ["member", "lead", "admin"] as const;

export type ClientMembershipRole = (typeof clientMembershipRoles)[number];

export interface ClientMembership {
  clientId: string;
  userId: string;
  role: ClientMembershipRole;
}

export interface SetClientPicInput {
  clientId: string;
  userId: string;
}

export interface HandoffRunInput {
  workspaceRunId: string;
  toUserId: string;
  expectedVersion: number;
  note?: string;
}

export function canEditRun(
  ownership: RunOwnership | null,
  currentUserId: string | null
): boolean {
  if (!ownership) return true;
  return Boolean(
    currentUserId && ownership.currentOwnerUserId === currentUserId
  );
}

export function departmentLabel(department: TeamDepartment): string {
  switch (department) {
    case "cs":
      return "CS";
    case "gd":
      return "GD";
    case "pm":
      return "PM";
    case "admin":
      return "Admin";
    case "unassigned":
      return "Team";
  }
}
