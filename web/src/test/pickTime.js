import { screen } from "@testing-library/react";

const stepTo = async (user, id, target) => {
  for (let i = 0; i < 30 && Number(screen.getByTestId(id).textContent) !== target; i++) {
    await user.click(screen.getByTestId(`${id}-up`));
  }
};

/** Drives ui/TimeSlotPicker's custom-time steppers: pickTime(user, "field-testid", "16:00"). */
export async function pickTime(user, testId, hhmm) {
  await user.click(screen.getByTestId(testId));
  const [h, m] = hhmm.split(":").map(Number);
  await stepTo(user, `${testId}-hour`, h);
  await stepTo(user, `${testId}-minute`, m);
  await user.click(screen.getByTestId(`${testId}-custom-set`));
}

export async function clearTime(user, testId) {
  await user.click(screen.getByTestId(testId));
  await user.click(screen.getByTestId(`${testId}-clear`));
}
