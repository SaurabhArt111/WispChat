import "../../styles/railPanels.css";

export default function PlaceholderPanel({ title, icon: Icon, description }) {
  return (
    <aside className="rail-panel">
      <div className="rail-panel-header">
        <h2>{title}</h2>
      </div>
      <div className="rail-panel-empty rail-panel-empty-tall">
        {Icon && <Icon size={34} />}
        <p>{description}</p>
      </div>
    </aside>
  );
}
