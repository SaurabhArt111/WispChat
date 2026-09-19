export default function QuickReactions({ emojis, current, onPick, align = "left" }) {
  return (
    <div className={`quick-reactions ${align}`}>
      {emojis.map((e) => (
        <button key={e} className={current === e ? "active" : ""} onClick={() => onPick(e)}>
          {e}
        </button>
      ))}
    </div>
  );
}
