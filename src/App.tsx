import { Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { MaterialsPage } from "./pages/MaterialsPage";
import { MetaPage } from "./pages/MetaPage";
import { PreviewPage } from "./pages/PreviewPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/reports/:id/meta" element={<MetaPage />} />
      <Route path="/reports/:id/materials" element={<MaterialsPage />} />
      <Route path="/reports/:id/preview" element={<PreviewPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
