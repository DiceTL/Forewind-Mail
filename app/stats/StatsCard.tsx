export default function StatsCard({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <article
      aria-label={title}
      className="rounded-lg border p-4"
    >
      <h3 className="text-sm text-muted-foreground">{title}</h3>
      <p className="text-2xl font-semibold">{value}</p>
    </article>
  );
}
