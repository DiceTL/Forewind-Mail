import StatsCard from "./StatsCard";

export type StatItem = {
  title: string;
  value: string;
};

export default function StatsGrid({ items }: { items: StatItem[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <StatsCard key={item.title} title={item.title} value={item.value} />
      ))}
    </div>
  );
}
