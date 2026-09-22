import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../styles/contextmenu.css";

const ContextMenuCtx = createContext(null);

export function ContextMenuProvider({ children }) {
  const [menu, setMenu] = useState(null); // { x, y, items, header }
  const menuRef = useRef(null);

  const openMenu = useCallback((event, items, header, options) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, items, header, reactions: options?.reactions });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) closeMenu();
    };
    const onKey = (e) => {
      if (e.key === "Escape") closeMenu();
    };
    const onScroll = () => closeMenu();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", closeMenu);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", closeMenu);
    };
  }, [menu, closeMenu]);

  return (
    <ContextMenuCtx.Provider value={{ openMenu, closeMenu }}>
      {children}
      {menu && <RenderedMenu menu={menu} menuRef={menuRef} closeMenu={closeMenu} />}
    </ContextMenuCtx.Provider>
  );
}

function RenderedMenu({ menu, menuRef, closeMenu }) {
  const [pos, setPos] = useState({ x: menu.x, y: menu.y, visible: false });

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let x = menu.x;
    let y = menu.y;
    const pad = 8;
    if (x + rect.width + pad > window.innerWidth) x = window.innerWidth - rect.width - pad;
    if (y + rect.height + pad > window.innerHeight) y = window.innerHeight - rect.height - pad;
    if (x < pad) x = pad;
    if (y < pad) y = pad;
    setPos({ x, y, visible: true });
  }, [menu]);

  return createPortal(
    <div ref={menuRef} className="ctx-menu-group" style={{ left: pos.x, top: pos.y, opacity: pos.visible ? 1 : 0 }}>
      {menu.reactions && (
        <div className="ctx-reaction-strip">
          {menu.reactions.emojis.map((e) => (
            <button
              key={e}
              className={menu.reactions.current === e ? "active" : ""}
              onClick={() => {
                closeMenu();
                menu.reactions.onPick(e);
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}
      <div className="ctx-menu" role="menu">
        {menu.header && <div className="ctx-menu-header">{menu.header}</div>}
        {menu.items.map((item, i) =>
          item.divider ? (
            <div key={i} className="ctx-menu-divider" />
          ) : (
            <button
              key={i}
              role="menuitem"
              className={`ctx-menu-item ${item.danger ? "danger" : ""} ${item.disabled ? "disabled" : ""}`}
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                closeMenu();
                item.onClick?.();
              }}
            >
              {item.icon && <span className="ctx-menu-icon">{item.icon}</span>}
              <span className="ctx-menu-label">{item.label}</span>
              {item.shortcut && <span className="ctx-menu-shortcut">{item.shortcut}</span>}
            </button>
          )
        )}
      </div>
    </div>,
    document.body
  );
}

export function useContextMenu() {
  return useContext(ContextMenuCtx);
}
