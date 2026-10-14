import { DatePicker } from "@tabdo/ui/components/date-picker";
import { TimePicker } from "@tabdo/ui/components/time-picker";

type Props = {
  value: string | null;
  onChange: (value: string | null) => void;
  labels?: { pickDate: string; clear: string; empty: string; hour: string; minute: string };
};

/** Calendar and time selections emit ISO instants using the user's local timezone. */
export function DateTimePicker({ value, onChange, labels }: Props) {
  const date = value && !Number.isNaN(Date.parse(value)) ? new Date(value) : null;
  const day = date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` : null;
  const time = date ? `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}` : "00:00";
  const change = (day: string | null, time: string) => onChange(day ? new Date(`${day}T${time}:00`).toISOString() : null);
  return <div className="grid min-w-0 gap-2 sm:grid-cols-2">
    <DatePicker size="default" labels={labels} value={day} onChange={day => change(day, time)} />
    <TimePicker labels={labels} disabled={!day} value={time} onChange={time => change(day, time)} />
  </div>;
}
