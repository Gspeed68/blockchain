import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ItemsPage } from "./pages/ItemsPage";
import { ItemDetailPage } from "./pages/ItemDetailPage";
import { RegisterItemPage } from "./pages/RegisterItemPage";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<ItemsPage />} />
        <Route path="/items/new" element={<RegisterItemPage />} />
        <Route path="/items/:id" element={<ItemDetailPage />} />
      </Route>
    </Routes>
  );
}
