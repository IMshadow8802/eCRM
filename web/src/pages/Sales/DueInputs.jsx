import dayjs from "dayjs";
import DateField from "../../components/ui/DateField";
import TimeSlotPicker from "../../components/ui/TimeSlotPicker";
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
      <TimeSlotPicker
        label="Time (optional)"
        value={time}
        date={date}
        error={isPastDue(date, time) ? "Pick a time from now on" : undefined}
        onChange={onTimeChange}
        data-testid={timeTestId}
      />
    </>
  );
}
