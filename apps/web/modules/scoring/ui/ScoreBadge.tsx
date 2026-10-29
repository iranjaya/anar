const styles = {
  hot: "bg-hot-soft text-hot",
  warm: "bg-warm-soft text-warm",
  cold: "bg-cold-soft text-cold",
};

export function ScoreBadge({
  priority,
  score,
}: {
  priority: "hot" | "warm" | "cold";
  score?: number;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold ${styles[priority]}`}
    >
      {priority[0].toUpperCase() + priority.slice(1)}
      {score !== undefined && ` · ${score}`}
    </span>
  );
}
