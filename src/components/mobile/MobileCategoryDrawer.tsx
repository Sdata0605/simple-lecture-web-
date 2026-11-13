import { FolderOpen } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

export interface MobileCategoryItem {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
}

interface MobileCategoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: MobileCategoryItem[];
  onSelect: (slug: string) => void;
}

// Bottom-sheet category picker for the mobile homepage search. Lives in its own
// module so the drawer library is only downloaded once a visitor opens it.
export const MobileCategoryDrawer = ({
  open,
  onOpenChange,
  categories,
  onSelect,
}: MobileCategoryDrawerProps) => (
  <Drawer open={open} onOpenChange={onOpenChange}>
    <DrawerContent>
      <DrawerHeader>
        <DrawerTitle>Browse Categories</DrawerTitle>
      </DrawerHeader>
      <div className="px-4 pb-6 grid grid-cols-2 gap-2 max-h-[60vh] overflow-y-auto">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => onSelect(cat.slug)}
            className="flex items-center gap-2 p-3 rounded-xl border bg-background hover:bg-accent text-left transition-colors"
          >
            {cat.icon ? (
              <span className="text-lg">{cat.icon}</span>
            ) : (
              <FolderOpen className="h-4 w-4 text-primary" />
            )}
            <span className="text-sm font-medium text-foreground truncate">{cat.name}</span>
          </button>
        ))}
      </div>
    </DrawerContent>
  </Drawer>
);

export default MobileCategoryDrawer;
