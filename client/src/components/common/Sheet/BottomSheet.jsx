import Sheet from "./Sheet";

/**
 * Android-style modal bottom sheet. See Sheet.jsx for the full prop list.
 *
 *   <BottomSheet title="Comments" snapStates={["hidden","half","expanded"]}
 *                header={…} footer={…} onClose={…}>
 *     …scrollable content…
 *   </BottomSheet>
 */
export default function BottomSheet(props) {
  return <Sheet {...props} edge="bottom" />;
}
