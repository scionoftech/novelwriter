import { Routes, Route, Navigate } from 'react-router-dom';
import Library from './pages/Library';
import NovelLayout from './pages/NovelLayout';
import Write from './pages/Write';
import Plan from './pages/Plan';
import Codex from './pages/Codex';
import ChatPage from './pages/Chat';
import Settings from './pages/Settings';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Library />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/novel/:novelId" element={<NovelLayout />}>
        <Route index element={<Navigate to="write" replace />} />
        <Route path="write" element={<Write />} />
        <Route path="plan" element={<Plan />} />
        <Route path="codex" element={<Codex />} />
        <Route path="chat" element={<ChatPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
