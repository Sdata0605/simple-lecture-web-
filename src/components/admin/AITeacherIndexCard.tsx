import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BookOpenCheck, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { fetchIndexCoverage, indexSubject, type IndexCoverageRow, type IndexProgress } from "@/lib/aiTeacherIndex";

type Run = { state: "running" | "done" | "error"; progress?: IndexProgress; error?: string };

function status(row: IndexCoverageRow) {
  if (row.eligible === 0) return { label: "Nothing published", cls: "bg-muted text-muted-foreground" };
  if (row.topics_indexed === 0) return { label: "Teacher can't see it", cls: "bg-red-100 text-red-800" };
  if (row.pending > 0 || row.stale > 0) return { label: "Partly indexed", cls: "bg-amber-100 text-amber-800" };
  return { label: "Ready", cls: "bg-emerald-100 text-emerald-800" };
}

/** Admin view of which subjects the AI Teacher can teach, with buttons to index what is missing. */
export function AITeacherIndexCard() {
  const qc = useQueryClient();
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const [bulk, setBulk] = useState(false);
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["ai-teacher-index-coverage"],
    queryFn: fetchIndexCoverage,
    staleTime: 30_000,
  });

  const rows = data ?? [];
  const todo = rows.filter((r) => r.pending > 0 || r.stale > 0);
  const busy = bulk || Object.values(runs).some((r) => r.state === "running");

  async function run(row: IndexCoverageRow, force = false): Promise<IndexProgress | null> {
    setRuns((p) => ({ ...p, [row.subject_id]: { state: "running" } }));
    try {
      const result = await indexSubject(row.subject_id, {
        force,
        onProgress: (progress) => setRuns((p) => ({ ...p, [row.subject_id]: { state: "running", progress } })),
      });
      setRuns((p) => ({ ...p, [row.subject_id]: { state: "done", progress: result } }));
      return result;
    } catch (e) {
      setRuns((p) => ({ ...p, [row.subject_id]: { state: "error", error: (e as Error).message } }));
      return null;
    } finally {
      await qc.invalidateQueries({ queryKey: ["ai-teacher-index-coverage"] });
      await qc.invalidateQueries({ queryKey: ["ai-teacher", "subjects"] });
    }
  }

  async function runAll() {
    setBulk(true);
    let ok = 0;
    for (const row of todo) if (await run(row)) ok++;
    setBulk(false);
    toast.success(`Indexed ${ok} of ${todo.length} subject${todo.length === 1 ? "" : "s"}`);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BookOpenCheck className="h-5 w-5 text-emerald-600" />
            <div>
              <CardTitle>AI Teacher knowledge index</CardTitle>
              <CardDescription>
                The AI Teacher (website and mobile app) can only teach subjects whose published lectures are indexed.
                New publishes are indexed automatically; use this to fill in anything that is missing.
              </CardDescription>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching || busy}>
              <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button size="sm" onClick={runAll} disabled={busy || todo.length === 0}>
              {bulk && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Index all pending{todo.length ? ` (${todo.length})` : ""}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading coverage…</p>
        ) : error ? (
          <p className="text-sm text-destructive">Could not load coverage: {(error as Error).message}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Courses</TableHead>
                  <TableHead className="text-right">Published</TableHead>
                  <TableHead className="text-right">Indexed</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const st = status(row);
                  const r = runs[row.subject_id];
                  return (
                    <TableRow key={row.subject_id}>
                      <TableCell className="font-medium">
                        {row.name}
                        {row.unpublished_with_markdown > 0 && (
                          <div className="text-xs font-normal text-muted-foreground">
                            {row.unpublished_with_markdown} more not published yet
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.courses.join(", ") || "—"}</TableCell>
                      <TableCell className="text-right">{row.eligible}</TableCell>
                      <TableCell className="text-right">{row.indexed}</TableCell>
                      <TableCell className="text-right">{row.pending}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={st.cls}>{st.label}</Badge>
                        {r?.state === "running" && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {r.progress ? `${r.progress.indexed + r.progress.unchanged} done, ${r.progress.remaining} left…` : "Starting…"}
                          </div>
                        )}
                        {r?.state === "done" && r.progress && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {r.progress.indexed} indexed{r.progress.pruned ? `, ${r.progress.pruned} removed` : ""}
                            {r.progress.failed.length > 0 && <span className="text-destructive"> · {r.progress.failed.length} failed: {r.progress.failed[0].error}</span>}
                            {r.progress.skipped.length > 0 && <span> · {r.progress.skipped.length} skipped ({r.progress.skipped[0].reason})</span>}
                          </div>
                        )}
                        {r?.state === "error" && <div className="text-xs text-destructive mt-1">{r.error}</div>}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button size="sm" variant="outline" disabled={busy || (row.pending === 0 && row.stale === 0)} onClick={() => run(row)}>
                          {r?.state === "running" && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                          Index
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || row.eligible === 0}
                          title="Re-embed every lecture of this subject, even if unchanged"
                          onClick={() => run(row, true)}
                        >
                          Rebuild
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">No subjects with published lectures yet.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
