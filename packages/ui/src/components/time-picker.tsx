import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@tabdo/ui/components/select";

export type TimePickerProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  labels?: { hour: string; minute: string };
};

/** A 24-hour control composed from the shared Select, without browser picker UI. */
export function TimePicker({ value, onChange, disabled, labels = { hour: "Hour", minute: "Minute" } }: TimePickerProps) {
  const [hour = "00", minute = "00"] = value.split(":");
  return <div className="flex min-w-0 items-center gap-2">
    <Select value={hour} disabled={disabled} onValueChange={hour => onChange(`${hour}:${minute}`)}>
      <SelectTrigger aria-label={labels.hour}><SelectValue /></SelectTrigger>
      <SelectContent><SelectGroup>{Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0")).map(hour => <SelectItem key={hour} value={hour}>{hour}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
    <span aria-hidden>:</span>
    <Select value={minute} disabled={disabled} onValueChange={minute => onChange(`${hour}:${minute}`)}>
      <SelectTrigger aria-label={labels.minute}><SelectValue /></SelectTrigger>
      <SelectContent><SelectGroup>{Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0")).map(minute => <SelectItem key={minute} value={minute}>{minute}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
  </div>;
}
