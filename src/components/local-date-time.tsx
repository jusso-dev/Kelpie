export default function LocalDateTime({
  value,
  timeZone,
}: {
  value: string;
  timeZone: string;
}) {
  const date = new Date(value);
  let formatted = value;
  if (!Number.isNaN(date.getTime())) {
    try {
      formatted = new Intl.DateTimeFormat("en-AU", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
        timeZone,
      }).format(date);
    } catch {
      formatted = date.toISOString();
    }
  }

  return <time dateTime={value}>{formatted}</time>;
}
