import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminPage } from './pages/admin'
import { AdminLoginPage } from './pages/admin-login'
import { JoinPage } from './pages/join'
import { PlayPage } from './pages/play'
import { StageFirstLookPage } from './pages/stage-first-look'
import { StagePerfectPage } from './pages/stage-perfect'
import { StageTaifPage } from './pages/stage-taif'
import { AdminGuard } from './components/admin-guard'
import { readSession } from './lib/session'

export default function App() {
  return <Routes>
    <Route path="/" element={<Navigate to={readSession() ? '/play' : '/join'} replace />} />
    <Route path="/join" element={<JoinPage />} />
    <Route path="/play" element={<PlayPage />} />
    <Route path="/admin/login" element={<AdminLoginPage />} />
    <Route path="/admin" element={<AdminGuard><AdminPage /></AdminGuard>} />
    <Route path="/stage/perfect-second" element={<AdminGuard><StagePerfectPage /></AdminGuard>} />
    <Route path="/stage/first-look" element={<AdminGuard><StageFirstLookPage /></AdminGuard>} />
    <Route path="/stage/taif" element={<AdminGuard><StageTaifPage /></AdminGuard>} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
}
