import Sheet from "./Sheet";

/**
 * Pull-down sheet anchored to the top edge (quick actions, notification-shade
 * style). Content stays pinned to the top and is revealed as the sheet opens;
 * the grip sits on the bottom edge. Same props as BottomSheet.
 */
export default function TopSheet(props) {
  return <Sheet {...props} edge="top" />;
}
