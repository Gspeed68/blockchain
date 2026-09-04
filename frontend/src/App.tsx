import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { CollectionPage } from "./pages/CollectionPage";
import { BottleDetailPage } from "./pages/BottleDetailPage";
import { AddBottlePage } from "./pages/AddBottlePage";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<CollectionPage />} />
        <Route path="/bottles/new" element={<AddBottlePage />} />
        <Route path="/bottles/:id" element={<BottleDetailPage />} />
      </Route>
    </Routes>
  );
}
