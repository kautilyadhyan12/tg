import { X } from 'lucide-react';

const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
const SORT_OPTIONS = [
  { value: 'name',     label: 'A–Z' },
  { value: 'popular',  label: 'Popular' },
  { value: 'calories', label: 'Calories' },
  { value: 'rating',   label: 'Rating' },
];

export default function FilterBar({
  categories,
  filters,
  onFilterChange,
  onClearFilters,
  totalResults,
}) {
  const hasActiveFilters =
    filters.category || filters.difficulty || filters.equipment || filters.muscle;

  return (
    <div className="space-y-3">
      {/* Filter row */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Category filter */}
        <select
          value={filters.category || ''}
          onChange={(e) => onFilterChange('category', e.target.value || null)}
          className="bg-dark-100 border border-white/10 text-white text-sm 
                     rounded-xl px-3 py-2 focus:outline-none focus:ring-2 
                     focus:ring-primary-500 cursor-pointer"
        >
          <option value="">All Categories</option>
          {categories.map((cat) => (
            <option key={cat.name} value={cat.name}>
              {cat.name} ({cat.count})
            </option>
          ))}
        </select>

        {/* Difficulty filter */}
        <select
          value={filters.difficulty || ''}
          onChange={(e) => onFilterChange('difficulty', e.target.value || null)}
          className="bg-dark-100 border border-white/10 text-white text-sm 
                     rounded-xl px-3 py-2 focus:outline-none focus:ring-2 
                     focus:ring-primary-500 cursor-pointer"
        >
          <option value="">All Levels</option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {d.charAt(0).toUpperCase() + d.slice(1)}
            </option>
          ))}
        </select>

        {/* Sort */}
        <select
          value={filters.sort || 'name'}
          onChange={(e) => onFilterChange('sort', e.target.value)}
          className="bg-dark-100 border border-white/10 text-white text-sm 
                     rounded-xl px-3 py-2 focus:outline-none focus:ring-2 
                     focus:ring-primary-500 cursor-pointer"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              Sort: {opt.label}
            </option>
          ))}
        </select>

        {/* Clear filters */}
        {hasActiveFilters && (
          <button
            onClick={onClearFilters}
            className="flex items-center gap-1 text-sm text-primary-400 
                       hover:text-primary-300 transition-colors px-3 py-2"
          >
            <X className="w-4 h-4" />
            Clear filters
          </button>
        )}

        {/* Result count */}
        <span className="text-gray-500 text-sm ml-auto">
          {totalResults} exercises
        </span>
      </div>

      {/* Active filter pills */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-2">
          {filters.category && (
            <ActivePill
              label={`Category: ${filters.category}`}
              onRemove={() => onFilterChange('category', null)}
            />
          )}
          {filters.difficulty && (
            <ActivePill
              label={`Level: ${filters.difficulty}`}
              onRemove={() => onFilterChange('difficulty', null)}
            />
          )}
          {filters.muscle && (
            <ActivePill
              label={`Muscle: ${filters.muscle}`}
              onRemove={() => onFilterChange('muscle', null)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ActivePill({ label, onRemove }) {
  return (
    <span className="inline-flex items-center gap-1 bg-primary-500/20 
                     text-primary-300 px-3 py-1 rounded-full text-xs">
      {label}
      <button onClick={onRemove} className="hover:text-white transition-colors">
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}