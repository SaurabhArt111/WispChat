import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import AuthPage from "./pages/AuthPage";
import ChatApp from "./pages/ChatApp";
import PwaManager from "./components/common/PwaManager";
import UnlockE2EEModal from "./components/common/UnlockE2EEModal";
import CallOverlay from "./components/Call/CallOverlay";

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="app-boot">
        <div className="app-boot-mark">wisp</div>
      </div>
    );
  }

  return (
    <>
      <Routes>
        <Route path="/auth" element={user ? <Navigate to="/" replace /> : <AuthPage />} />
        <Route path="/*" element={user ? <ChatApp /> : <Navigate to="/auth" replace />} />
      </Routes>
      <PwaManager />
      <UnlockE2EEModal />
      <CallOverlay />
    </>
  );
}
