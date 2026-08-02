// The shared design system. Screens import from here and nowhere else.
//
// Two rules, both enforced by eslint (see .eslintrc.js):
//   1. Never import Text from "react-native" in a screen — use this Text, so
//      every string picks a typography variant instead of a raw size/weight.
//   2. Never write a colour literal or a raw spacing number — use the tokens
//      in src/theme.
//
// If a screen needs a widget that is not here, add it here. Two screens
// building the same thing separately is the failure mode this prevents.
export { default as Avatar } from "./Avatar";
export { default as Button } from "./Button";
export { default as Card } from "./Card";
export { default as Chip } from "./Chip";
export { default as DateField } from "./DateField";
export { default as Dialog } from "./Dialog";
export { default as Divider } from "./Divider";
export { default as EmptyState } from "./EmptyState";
export { default as Input } from "./Input";
export { default as PageHeader } from "./PageHeader";
export { default as Screen } from "./Screen";
export { default as ScreenHeader } from "./ScreenHeader";
export { default as Select } from "./Select";
export { default as Sheet } from "./Sheet";
export { default as Text } from "./Text";

export type { ButtonProps, ButtonSize, ButtonVariant } from "./Button";
export type { ChipProps, ChipTone } from "./Chip";
export type { DateFieldProps } from "./DateField";
export type { DialogProps } from "./Dialog";
export type { EmptyStateProps } from "./EmptyState";
export type { InputProps } from "./Input";
export type { PageHeaderAction, PageHeaderProps } from "./PageHeader";
export type { ScreenProps } from "./Screen";
export type { ScreenHeaderAction, ScreenHeaderProps } from "./ScreenHeader";
export type { SelectOption, SelectProps } from "./Select";
export type { SheetProps, SheetRef } from "./Sheet";
export type { TextProps } from "./Text";
