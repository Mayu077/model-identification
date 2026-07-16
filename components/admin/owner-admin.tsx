"use client"

import { useState } from "react"
import { createOwnerInvite, revokeOwnerInvite } from "@/app/actions/admin"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"

type Invite = { id: string; organizationName: string | null; expiresAt: Date; consumedAt: Date | null; revokedAt: Date | null; createdAt: Date }
type Log = { id: number; action: string; entityType: string; entityId: string | null; createdAt: Date; metadata: unknown }
export function OwnerAdmin({ invites, logs }: { invites: Invite[]; logs: Log[] }) {
  const [name, setName] = useState("")
  const [generated, setGenerated] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  async function create() { setLoading(true); try { const result = await createOwnerInvite(name); setGenerated(result.code); setName(""); toast.success("Invitation created. Copy it now; it will not be shown again.") } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to create invitation") } finally { setLoading(false) } }
  return <div className="flex flex-col gap-6">
    <Card><CardHeader><CardTitle>Invite an owner</CardTitle></CardHeader><CardContent className="flex flex-col gap-4"><div className="flex flex-col gap-2"><Label htmlFor="org-name">New organization name</Label><Input id="org-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Example Logistics" /></div><Button onClick={create} disabled={loading || name.trim().length < 2}>{loading ? "Creating..." : "Generate one-time code"}</Button>{generated && <div className="rounded-md border border-border bg-muted p-3"><p className="text-xs text-muted-foreground">Copy this code now</p><code className="mt-1 block break-all font-mono text-sm">{generated}</code></div>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Invitations</CardTitle></CardHeader><CardContent><ul className="flex flex-col divide-y divide-border">{invites.map((invite) => <li key={invite.id} className="flex items-center justify-between gap-4 py-3"><div><p className="text-sm font-medium">{invite.organizationName}</p><p className="text-xs text-muted-foreground">Expires {new Date(invite.expiresAt).toLocaleDateString()}</p></div><div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{invite.consumedAt ? "Used" : invite.revokedAt ? "Revoked" : "Active"}</span>{!invite.consumedAt && !invite.revokedAt && <Button size="sm" variant="outline" onClick={() => revokeOwnerInvite(invite.id)}>Revoke</Button>}</div></li>)}</ul></CardContent></Card>
    <Card><CardHeader><CardTitle>Audit log</CardTitle></CardHeader><CardContent><ul className="flex flex-col divide-y divide-border">{logs.map((log) => <li key={log.id} className="py-3"><div className="flex items-center justify-between gap-4"><p className="font-mono text-sm">{log.action}</p><time className="text-xs text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</time></div><p className="mt-1 text-xs text-muted-foreground">{log.entityType}{log.entityId ? ` · ${log.entityId}` : ""}</p></li>)}</ul></CardContent></Card>
  </div>
}
