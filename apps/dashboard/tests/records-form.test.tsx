import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecordsForm } from '@/components/records-form'

describe('RecordsForm', () => {
  it('renders inputs pre-filled from `initial`', () => {
    render(
      <RecordsForm
        initial={{
          'agent-context': '{"name":"hi"}',
          'agent-endpoint[mcp]': 'https://mybot.example/mcp',
        }}
        onSubmit={() => {}}
      />,
    )

    expect((screen.getByLabelText(/agent-context/i) as HTMLTextAreaElement).value)
      .toBe('{"name":"hi"}')
    expect((screen.getByLabelText(/mcp/i) as HTMLInputElement).value)
      .toBe('https://mybot.example/mcp')
  })

  it('rejects invalid JSON in agent-context', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<RecordsForm initial={{}} onSubmit={onSubmit} />)

    const textarea = screen.getByLabelText(/agent-context/i)
    await user.clear(textarea)
    await user.type(textarea, '{{not json')
    await user.click(screen.getByRole('button', { name: /save records/i }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/agent-context must be valid JSON/i)).toBeInTheDocument()
  })

  it('rejects malformed URLs in endpoint fields', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<RecordsForm initial={{}} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/mcp/i), 'not-a-url')
    await user.click(screen.getByRole('button', { name: /save records/i }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/agent-endpoint\[mcp\] must be a valid URL/i)).toBeInTheDocument()
  })

  it('strips empty fields and submits a Record<string,string>', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<RecordsForm initial={{}} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText(/agent-context/i), '{{"name":"alice"}')
    await user.type(screen.getByLabelText(/web/i), 'https://alice.example')
    await user.click(screen.getByRole('button', { name: /save records/i }))

    expect(onSubmit).toHaveBeenCalledOnce()
    const arg = onSubmit.mock.calls[0]![0] as Record<string, string>
    expect(arg['agent-context']).toBe('{"name":"alice"}')
    expect(arg['agent-endpoint[web]']).toBe('https://alice.example')
    expect(arg['agent-endpoint[mcp]']).toBeUndefined()
  })
})
