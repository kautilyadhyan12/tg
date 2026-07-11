import { useState } from 'react';
import { createContext, useContext } from 'react';
import Sidebar from './Sidebar';

// ─── Sidebar context — lets any child know if sidebar is collapsed ─────────────
export const SidebarContext = createContext({ collapsed: false, setCollapsed: () => {} });
export const useSidebar = () => useContext(SidebarContext);

export default function AppLayout({ children }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed }}>
      <div className="flex min-h-screen bg-dark-200">

        {/* Sidebar — receives collapsed state and setter as props */}
        <Sidebar
          collapsed={collapsed}
          setCollapsed={setCollapsed}
        />

        {/* Main content — margin shifts when sidebar collapses */}
        <main
          className="flex-1 min-h-screen overflow-y-auto transition-all duration-300"
          style={{ marginLeft: collapsed ? 64 : 256 }}
        >
          {children}
        </main>

      </div>
    </SidebarContext.Provider>
  );
}