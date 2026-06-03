import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { ShieldAlert } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface NutritionInfo {
  calories?: number;
  fatG?: number;
  carbsG?: number;
  proteinG?: number;
  sodiumMg?: number;
}

interface QrItem {
  id: string;
  name: string;
  nameI18n?: Record<string, string>;
  description?: string | null;
  descriptionI18n?: Record<string, string>;
  priceCents: number;
  imageUrl?: string | null;
  tags?: string[];
  allergens?: string[];
  nutritionInfo?: NutritionInfo | null;
}

interface QrCategory {
  id: string;
  name: string;
  color?: string | null;
  items: QrItem[];
}

interface QrMenuData {
  menu: { id: string; name: string; description?: string | null; currency: string };
  categories: QrCategory[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: currency || 'CAD' }).format(cents / 100);
}

function buildApiUrl(path: string) {
  return path.startsWith('http') ? path : `/api/v1${path}`;
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function QrMenuPage() {
  const { wsId, menuId } = useParams<{ wsId: string; menuId: string }>();
  const [searchParams] = useSearchParams();
  const lang = searchParams.get('lang') ?? 'en';

  const [data, setData] = useState<QrMenuData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!wsId || !menuId) return;
    setLoading(true);
    fetch(buildApiUrl(`/pos/qr-menu/${wsId}/${menuId}`))
      .then((r) => {
        if (!r.ok) throw new Error('Menu not found');
        return r.json() as Promise<QrMenuData>;
      })
      .then((d) => { setData(d); setLoading(false); })
      .catch((e: unknown) => { setError((e as Error).message); setLoading(false); });
  }, [wsId, menuId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-zinc-950">
        <div className="w-8 h-8 border-2 border-zinc-200 border-t-zinc-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-white dark:bg-zinc-950 px-4">
        <ShieldAlert className="w-10 h-10 text-red-400" />
        <p className="text-zinc-500 text-sm">{error ?? 'Menu not available'}</p>
      </div>
    );
  }

  const { menu, categories } = data;

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/90 dark:bg-zinc-950/90 backdrop-blur border-b border-zinc-200 dark:border-zinc-800 px-4 py-3">
        <h1 className="text-lg font-bold truncate">{menu.name}</h1>
        {menu.description && (
          <p className="text-xs text-zinc-500 truncate">{menu.description}</p>
        )}
      </div>

      {/* Category nav pills */}
      {categories.length > 1 && (
        <div className="flex gap-2 px-4 py-2 overflow-x-auto border-b border-zinc-100 dark:border-zinc-800">
          {categories.map((cat) => (
            <a
              key={cat.id}
              href={`#cat-${cat.id}`}
              className="flex-shrink-0 text-xs px-3 py-1 rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              {cat.name}
            </a>
          ))}
        </div>
      )}

      {/* Menu content */}
      <div className="pb-16">
        {categories.map((cat) => (
          <section key={cat.id} id={`cat-${cat.id}`} className="pt-4">
            <div
              className="px-4 pb-2 flex items-center gap-2"
            >
              {cat.color && (
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: cat.color }} />
              )}
              <h2 className="font-bold text-base">{cat.name}</h2>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {cat.items.map((item) => {
                const displayName = (lang !== 'en' && item.nameI18n?.[lang]) ? item.nameI18n[lang]! : item.name;
                const displayDesc = (lang !== 'en' && item.descriptionI18n?.[lang]) ? item.descriptionI18n[lang] : item.description;
                const imgSrc = item.imageUrl
                  ? (item.imageUrl.startsWith('http') || item.imageUrl.startsWith('data:') ? item.imageUrl : buildApiUrl(item.imageUrl))
                  : null;

                return (
                  <div key={item.id} className="px-4 py-3 flex gap-3">
                    {imgSrc && (
                      <img
                        src={imgSrc}
                        alt={displayName}
                        className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-sm leading-tight">{displayName}</span>
                        <span className="font-bold text-sm text-emerald-600 dark:text-emerald-400 flex-shrink-0">
                          {formatPrice(item.priceCents, menu.currency)}
                        </span>
                      </div>

                      {displayDesc && (
                        <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{displayDesc}</p>
                      )}

                      {/* Tags */}
                      {item.tags && item.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {item.tags.map((t) => (
                            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Allergens */}
                      {item.allergens && item.allergens.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {item.allergens.map((a) => (
                            <span key={a} className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
                              {a}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Nutrition */}
                      {item.nutritionInfo && (
                        <div className="mt-1.5 text-[10px] text-zinc-400 flex flex-wrap gap-x-2.5 gap-y-0.5">
                          {item.nutritionInfo.calories != null && <span>{item.nutritionInfo.calories} kcal</span>}
                          {item.nutritionInfo.fatG != null && <span>Fat {item.nutritionInfo.fatG}g</span>}
                          {item.nutritionInfo.carbsG != null && <span>Carbs {item.nutritionInfo.carbsG}g</span>}
                          {item.nutritionInfo.proteinG != null && <span>Protein {item.nutritionInfo.proteinG}g</span>}
                          {item.nutritionInfo.sodiumMg != null && <span>Sodium {item.nutritionInfo.sodiumMg}mg</span>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* Footer */}
      <div className="fixed bottom-0 left-0 right-0 py-2 px-4 bg-white/80 dark:bg-zinc-950/80 backdrop-blur border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
        <span className="text-[10px] text-zinc-400">Powered by Nexari</span>
        {lang === 'en' && (
          <a href="?lang=fr" className="text-[10px] text-zinc-400 hover:text-zinc-600 underline">Français</a>
        )}
        {lang === 'fr' && (
          <a href="?lang=en" className="text-[10px] text-zinc-400 hover:text-zinc-600 underline">English</a>
        )}
      </div>
    </div>
  );
}
