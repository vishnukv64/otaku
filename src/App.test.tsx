import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('renders the app title', () => {
    render(<App />)
    expect(screen.getByText('Otaku')).toBeInTheDocument()
  })

  it('displays the correct subtitle', () => {
    render(<App />)
    expect(screen.getByText('Cross-Platform Anime & Manga Viewer')).toBeInTheDocument()
  })
})
