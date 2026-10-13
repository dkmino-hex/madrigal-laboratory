export function trackJob(projectId: string, jobId: string) {
  return { projectId, jobId };
}
export function JobCard({ projectId, jobId }: { projectId: string; jobId: string }) {
  return <p>Задание {jobId} · проект {projectId}</p>;
}
export function JobsCenter({ projectId }: { projectId?: string }) {
  return <p>Задания {projectId ?? ''}</p>;
}
