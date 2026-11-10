// The shared design system (E · Midnight Sorbet). Screens import from here and nowhere else.
//
// Two rules, both enforced by eslint and src/test/designRules.test.ts:
//   1. Never import Text from "react-native" in a screen — use this Text, so
//      every string picks a typography variant instead of a raw size/weight.
//   2. Never write a colour literal or a raw spacing number — use the tokens.
//
// If a screen needs a widget that is not here, add it here.
export { ActionBar } from "./ActionBar";
export { ActionSheet } from "./ActionSheet";
export { Avatar, AvatarStack, avatarTone } from "./Avatar";
export { Band, BandSheet } from "./Band";
export { BoardColumns, boardColumnWidth, BOARD_GAP } from "./BoardColumns";
export { Button } from "./Button";
export { Card } from "./Card";
export { Checkbox } from "./Checkbox";
export { ChoiceList, Radio, Stepper } from "./ChoiceList";
export { ComposeSheet } from "./ComposeSheet";
export { Chip } from "./Chip";
export { CountBadge, CountPill, capCount } from "./CountBadge";
export { DateField, toISODate } from "./DateField";
export { Dialog } from "./Dialog";
export { DynamicField } from "./DynamicField";
export { EmptyState, ErrorCard, SkeletonRows } from "./EmptyState";
export { Facts } from "./Facts";
export { FieldHelp, FieldLabel, FieldPrefix, FieldRow } from "./Field";
export { FigureBox, HeroCard, ModuleTile, SplitBar, StatGrid } from "./HeroCard";
export { CircleAction, HeaderButton, IconButton } from "./IconButton";
export { Input } from "./Input";
export { GroupHeader, ListGroup, ListGroupCell, ListRow } from "./List";
export { LogCallSheet } from "./LogCallSheet";
export { MobileInput } from "./MobileInput";
export { Footnote, InfoNote, PageDots } from "./Notes";
export { ProgressBar } from "./ProgressBar";
export { Refresher } from "./Refresher";
export { Screen } from "./Screen";
export { SearchField } from "./SearchField";
export { Select } from "./Select";
export { Sheet, SheetBackHandler } from "./Sheet";
export { StatusBadge } from "./StatusBadge";
export { SwipeRow } from "./SwipeRow";
export { BandTabs, FilterPills, FilterPillsSkeleton, SegmentedTabs } from "./Tabs";
export { Timeline } from "./Timeline";
export { ToastProvider, useToast } from "./Toast";
export { Text } from "./Text";
export { useLayout, layoutFor } from "./useLayout";
export { default as useKeyboardOpen } from "./useKeyboardOpen";
export { KeyboardScrollView } from "./KeyboardScrollView";

export type { ActionBarProps, BarAction } from "./ActionBar";
export type { ActionSheetProps, SheetAction } from "./ActionSheet";
export type { AvatarProps, AvatarStackProps } from "./Avatar";
export type { BandProps, BandSheetProps, BandVariant } from "./Band";
export type { BoardColumnsProps } from "./BoardColumns";
export type { ButtonProps, ButtonSize, ButtonVariant } from "./Button";
export type { CardProps, CardTone } from "./Card";
export type { CheckboxProps } from "./Checkbox";
export type { Choice, ChoiceListProps, StepperProps } from "./ChoiceList";
export type { ChipProps, ChipSize, ChipTone } from "./Chip";
export type { ComposeField, ComposeSheetProps } from "./ComposeSheet";
export type { CountBadgeProps, CountPillProps } from "./CountBadge";
export type { DateFieldProps } from "./DateField";
export type { DialogProps } from "./Dialog";
export type { DynamicFieldProps } from "./DynamicField";
export type { EmptyStateProps, ErrorCardProps } from "./EmptyState";
export type { Fact, FactsProps } from "./Facts";
export type { HeroCardProps, HeroStat, ModuleTileProps } from "./HeroCard";
export type { CircleActionProps, HeaderButtonProps, IconButtonProps } from "./IconButton";
export type { GroupHeaderProps, ListRowProps, RowRight } from "./List";
export type { CallDirection, LogCallSheetProps, LogCallThen, LogCallValues } from "./LogCallSheet";
export type { InputProps } from "./Input";
export type { MobileInputProps } from "./MobileInput";
export type { ProgressBarProps } from "./ProgressBar";
export type { RefresherProps } from "./Refresher";
export type { ScreenProps } from "./Screen";
export type { SearchFieldProps } from "./SearchField";
export type { SelectOption, SelectProps } from "./Select";
export type { SheetProps, SheetRef } from "./Sheet";
export type { StatusBadgeProps, StatusBadgeSize } from "./StatusBadge";
export type { SwipeAction, SwipeRowProps } from "./SwipeRow";
export type { BandTabsProps, FilterOption, FilterPillsProps, SegmentedTabsProps, TabOption } from "./Tabs";
export type { TimelineEntry, TimelineProps } from "./Timeline";
export type { TextProps } from "./Text";
export type { Layout, SizeClass } from "./useLayout";
