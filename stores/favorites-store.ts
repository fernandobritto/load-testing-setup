import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { FlowNodeType } from '@/lib/flow/types'

interface FavoritesState {
  favorites: FlowNodeType[]
  toggle: (type: FlowNodeType) => void
  isFavorite: (type: FlowNodeType) => boolean
}

/** User-pinned palette components, shown at the top of the builder sidebar. */
export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      favorites: [],
      toggle: (type) =>
        set((state) => ({
          favorites: state.favorites.includes(type)
            ? state.favorites.filter((entry) => entry !== type)
            : [...state.favorites, type]
        })),
      isFavorite: (type) => get().favorites.includes(type)
    }),
    { name: 'k6-studio-favorites' }
  )
)
