import { useState } from "react";
import { Users, Plus, Check, X, LogOut, Crown, Building2, CircleDot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOrg } from "../context/OrgContext";
import {
  useAllOrganizations,
  useMyMemberships,
  useMyJoinRequests,
  useOrgMembers,
  usePendingJoinRequests,
  useCreateOrg,
  useRequestJoin,
  useCancelRequest,
  useApproveRequest,
  useRejectRequest,
  useLeaveOrg,
} from "../hooks/useOrganizations";
import { useAuth } from "@/contexts/AuthContext";

export function OrganizationsCard() {
  const { user, profile } = useAuth();
  const { selectedOrgId, setSelectedOrgId, selectedOrg, myMembership } = useOrg();
  const { data: memberships } = useMyMemberships();
  const { data: orgs } = useAllOrganizations();
  const { data: members } = useOrgMembers(selectedOrgId);
  const { data: pending } = usePendingJoinRequests(selectedOrgId);
  const { data: myRequests } = useMyJoinRequests();
  const createOrg = useCreateOrg();
  const requestJoin = useRequestJoin();
  const cancelRequest = useCancelRequest();
  const approveRequest = useApproveRequest();
  const rejectRequest = useRejectRequest();
  const leaveOrg = useLeaveOrg();

  const [newOrgName, setNewOrgName] = useState("");
  const [creating, setCreating] = useState(false);

  const isAdmin = myMembership?.role === "owner" || myMembership?.role === "admin";
  const isOwner = myMembership?.role === "owner";
  const myOrgIds = new Set((memberships ?? []).map((m) => m.org_id));
  const myPendingOrgIds = new Set(
    (myRequests ?? []).filter((r) => r.status === "pending").map((r) => r.org_id),
  );

  // Active memberships resolved to their org rows (for the "Your organizations" list).
  const myOrgs = (memberships ?? []).flatMap((membership) => {
    const org = orgs?.find((o) => o.id === membership.org_id);
    return org ? [{ membership, org }] : [];
  });

  const availableOrgs = (orgs ?? []).filter((o) => !myOrgIds.has(o.id));
  const myLabel = profile?.full_name ?? profile?.email ?? user?.email ?? "You";

  const handleCreate = async () => {
    if (!newOrgName.trim()) return;
    const slug = newOrgName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    setCreating(true);
    try {
      const org = await createOrg.mutateAsync({ name: newOrgName.trim(), slug });
      setSelectedOrgId(org.id);
      setNewOrgName("");
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="console-panel space-y-4 p-5">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-purple-400" />
        <h2 className="font-display text-sm font-semibold">Organizations</h2>
      </div>

      {/* Membership status banner — the clear "you're part of an org" indicator. */}
      {selectedOrg ? (
        <div className="flex items-start gap-3 rounded-lg border border-purple-500/30 bg-purple-950/20 px-4 py-3">
          {isOwner ? (
            <Crown className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          ) : (
            <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-purple-300" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {isOwner ? "You own " : "You're a member of "}
              <span className="text-purple-200">{selectedOrg.name}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Role:{" "}
              <span className="font-medium capitalize text-foreground">
                {myMembership?.role ?? "member"}
              </span>
              {members ? ` · ${members.length} member${members.length === 1 ? "" : "s"}` : ""}
            </p>
          </div>
        </div>
      ) : myOrgs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
          You're not part of an organization yet. Request to join one below, or create your own to
          start sharing Hive detections with teammates.
        </div>
      ) : null}

      {/* Your organizations — every active membership, with active switch. */}
      {myOrgs.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
            Your organizations
          </p>
          <div className="space-y-1">
            {myOrgs.map(({ membership, org }) => {
              const active = org.id === selectedOrgId;
              return (
                <div
                  key={org.id}
                  className="flex items-center justify-between rounded border border-border px-3 py-2 text-xs"
                >
                  <span className="flex items-center gap-1.5">
                    {membership.role === "owner" && <Crown className="h-3 w-3 text-amber-400" />}
                    <span className="font-medium text-foreground">{org.name}</span>
                    <span className="text-muted-foreground capitalize">· {membership.role}</span>
                  </span>
                  {active ? (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                      <CircleDot className="h-3 w-3" /> Active
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px] text-purple-300"
                      onClick={() => setSelectedOrgId(org.id)}
                    >
                      Set active
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Member list for the active org */}
      {selectedOrg && members && members.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">Members</p>
          <div className="space-y-1">
            {members.map((m) => {
              const isMe = m.user_id === user?.id;
              return (
                <div key={m.id} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-foreground">
                    {m.role === "owner" && <Crown className="h-3 w-3 text-amber-400" />}
                    {isMe ? `${myLabel} (you)` : `Member · ${m.user_id.slice(0, 8)}`}
                  </span>
                  <span className="capitalize text-muted-foreground">{m.role}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pending join requests (admin only) */}
      {isAdmin && pending && pending.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] uppercase tracking-wider text-yellow-400">
            Pending requests
          </p>
          <div className="space-y-2">
            {pending.map((req) => (
              <div
                key={req.id}
                className="flex items-center justify-between rounded border border-yellow-500/30 bg-yellow-950/20 px-3 py-2 text-xs"
              >
                <span className="text-foreground">Request · {req.user_id.slice(0, 8)}</span>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-green-400 hover:text-green-300"
                    onClick={() =>
                      approveRequest.mutate({
                        requestId: req.id,
                        orgId: req.org_id,
                        targetUserId: req.user_id,
                      })
                    }
                  >
                    <Check className="h-3 w-3" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-red-400 hover:text-red-300"
                    onClick={() => rejectRequest.mutate(req.id)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Browse orgs to join */}
      {availableOrgs.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
            Available organizations
          </p>
          <div className="space-y-1">
            {availableOrgs.map((org) => {
              const hasPending = myPendingOrgIds.has(org.id);
              const myReq = (myRequests ?? []).find(
                (r) => r.org_id === org.id && r.status === "pending",
              );
              return (
                <div
                  key={org.id}
                  className="flex items-center justify-between rounded border border-border px-3 py-2 text-xs"
                >
                  <span>{org.name}</span>
                  {hasPending ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px] text-yellow-400"
                      onClick={() => myReq && cancelRequest.mutate(myReq.id)}
                    >
                      Pending · cancel
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 border-purple-500/40 text-[10px] text-purple-300"
                      onClick={() => requestJoin.mutate({ orgId: org.id })}
                      disabled={requestJoin.isPending}
                    >
                      Request to join
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Leave org (non-owners) */}
      {selectedOrg && myMembership && !isOwner && (
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => leaveOrg.mutate(selectedOrg.id)}
        >
          <LogOut className="mr-1 h-3 w-3" /> Leave {selectedOrg.name}
        </Button>
      )}

      {/* Create org */}
      <div className="flex gap-2 border-t border-border/60 pt-3">
        <input
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-purple-500"
          placeholder="New organization name"
          value={newOrgName}
          onChange={(e) => setNewOrgName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        />
        <Button
          size="sm"
          variant="outline"
          className="border-purple-500/40 text-purple-300"
          onClick={handleCreate}
          disabled={creating || !newOrgName.trim()}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </section>
  );
}
