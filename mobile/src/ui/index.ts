// The shared design system (E · Midnight Sorbet). Screens import from here and nowhere else.
//
// Two rules, both enforced by eslint and src/test/designRules.test.ts:
//   1. Never import Text from "react-native" in a screen — use this Text, so
//      every string picks a typography variant instead of a raw size/weight.
//   2. Never write a colour literal or a raw spacing number — use the tokens.
//
// If a screen needs a widget that is not here, add it here.
export { default as ActionBar, MAX_BAR_ACTIONS } from "./ActionBar";
export { default as ActionSheet } from "./ActionSheet";
export { default as Avatar, AvatarStack, avatarTone } from "./Avatar";
export { Band, BandSheet } from "./Band";
export { default as BoardColumns, boardColumnWidth, BOARD_GAP } from "./BoardColumns";
export { default as Button } from "./Button";
export { default as Card } from "./Card";
export { default as Checkbox } from "./Checkbox";
export { ChoiceList, Radio, Stepper } from "./ChoiceList";
export { default as ComposeSheet } from "./ComposeSheet";
export { default as Chip } from "./Chip";
export { default as CountBadge, CountPill, capCount } from "./CountBadge";
export { default as DateField, toISODate } from "./DateField";
export { default as Dialog } from "./Dialog";
export { default as DynamicField } from "./DynamicField";
export { default as Divider } from "./Divider";
export { default as EmptyState, ErrorCard, SkeletonRows } from "./EmptyState";
export { default as Facts } from "./Facts";
export { FieldHelp, FieldLabel, FieldPrefix, FieldRow } from "./Field";
export { FigureBox, HeroCard, ModuleTile, SplitBar, StatGrid } from "./HeroCard";
export { CircleAction, HeaderButton, IconButton } from "./IconButton";
export { default as Input } from "./Input";
export { GroupHeader, ListGroup, ListRow } from "./List";
export { default as LogCallSheet } from "./LogCallSheet";
export { default as MobileInput } from "./MobileInput";
export { Footnote, InfoNote, PageDots } from "./Notes";
export { default as ProgressBar } from "./ProgressBar";
export { default as Refresher } from "./Refresher";
export { default as Screen } from "./Screen";
export { default as ScreenLoader } from "./ScreenLoader";
export { default as SearchField } from "./SearchField";
export { default as Select } from "./Select";
export { default as Sheet, SheetBackHandler, SheetHeader } from "./Sheet";
export { default as StatusBadge } from "./StatusBadge";
export { default as SwipeRow } from "./SwipeRow";
export { BandTabs, FilterPills, FilterPillsSkeleton, SegmentedTabs } from "./Tabs";
export { default as Timeline } from "./Timeline";
export { ToastProvider, useToast } from "./Toast";
export { default as Text } from "./Text";
export { default as useLayout, layoutFor } from "./useLayout";
// retired (Task 40): pre-E components still read by un-migrated screens.
export { default as ChipGroup } from "./ChipGroup";
export { default as Fab } from "./Fab";
export { default as Glyph } from "./Glyph";
export { default as MenuList } from "./MenuList";
export { default as ScreenHeader } from "./ScreenHeader";
export { default as Segmented } from "./Segmented";

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
export type { ChipGroupProps, ChipOption } from "./ChipGroup";
export type { ComposeField, ComposeSheetProps } from "./ComposeSheet";
export type { CountBadgeProps, CountPillProps } from "./CountBadge";
export type { DateFieldProps } from "./DateField";
export type { DialogProps } from "./Dialog";
export type { DynamicFieldProps } from "./DynamicField";
export type { EmptyStateProps, ErrorCardProps } from "./EmptyState";
export type { Fact, FactsProps } from "./Facts";
export type { FabProps } from "./Fab";
export type { GlyphProps, GlyphSize } from "./Glyph";
export type { HeroCardProps, HeroStat, ModuleTileProps } from "./HeroCard";
export type { CircleActionProps, HeaderButtonProps, IconButtonProps } from "./IconButton";
export type { GroupHeaderProps, ListRowProps, RowRight } from "./List";
export type { CallDirection, LogCallSheetProps, LogCallThen, LogCallValues } from "./LogCallSheet";
export type { MenuListRow } from "./MenuList";
export type { InputProps } from "./Input";
export type { MobileInputProps } from "./MobileInput";
export type { ProgressBarProps } from "./ProgressBar";
export type { RefresherProps } from "./Refresher";
export type { ScreenProps } from "./Screen";
export type { ScreenLoaderProps } from "./ScreenLoader";
export type { ScreenHeaderAction, ScreenHeaderProps } from "./ScreenHeader";
export type { SearchFieldProps } from "./SearchField";
export type { SegmentedOption, SegmentedProps } from "./Segmented";
export type { SelectOption, SelectProps } from "./Select";
export type { SheetHeaderProps, SheetProps, SheetRef } from "./Sheet";
export type { StatusBadgeProps, StatusBadgeSize } from "./StatusBadge";
export type { SwipeAction, SwipeRowProps } from "./SwipeRow";
export type { BandTabsProps, FilterOption, FilterPillsProps, SegmentedTabsProps, TabOption } from "./Tabs";
export type { TimelineEntry, TimelineProps } from "./Timeline";
export type { TextProps } from "./Text";
export type { Layout, SizeClass } from "./useLayout";
