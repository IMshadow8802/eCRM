import dayjs from "dayjs";
import DateField from "../../components/ui/DateField";
import TextInput from "../../components/ui/TextInput";
import { isPastDue } from "./followUpDue";

/** A follow-up's day plus an optional time, as sibling fields. */
export default function DueInputs({ date, time, onDateChange, onTimeChange, dateLabel, required, dateTestId, timeTestId }) {
  return (
    <>
      <DateField
        label={dateLabel}
        required={required}
        value={date}
        minDate={dayjs()}
        onChange={onDateChange}
        data-testid={dateTestId}
      />
      <TextInput
        type="time"
        label="Time (optional)"
        value={time}
        disabled={!date}
        error={isPastDue(date, time) ? "Pick a time from now on" : undefined}
        onChange={(e) => onTimeChange(e.target.value)}
        data-testid={timeTestId}
      />
    </>
  );
}
