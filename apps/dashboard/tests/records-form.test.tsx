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
          name: 'My Agent',
          'com.github': 'happys1ngh',
        }}
        onSubmit={() => {}}
      />,
    )

    expect((screen.getByLabelText('agent-context (JSON)') as HTMLTextAreaElement).value)
      .toBe('{"name":"hi"}')
    expect((screen.getByLabelText('agent-endpoint[mcp]') as HTMLInputElement).value)
      .toBe('https://mybot.example/mcp')
    expect((screen.getByLabelText('name') as HTMLInputElement).value).toBe('My Agent')
    expect((screen.getByLabelText('com.github') as HTMLInputElement).value).toBe('happys1ngh')
  })

  it('rejects invalid JSON in agent-context', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<RecordsForm initial={{}} onSubmit={onSubmit} />)

    const textarea = screen.getByLabelText('agent-context (JSON)')
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

    await user.type(screen.getByLabelText('agent-endpoint[mcp]'), 'not-a-url')
    await user.click(screen.getByRole('button', { name: /save records/i }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/agent-endpoint\[mcp\] must be a valid URL/i)).toBeInTheDocument()
  })

  it('strips empty fields and submits a Record<string,string>', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<RecordsForm initial={{}} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('agent-context (JSON)'), '{{"name":"alice"}')
    await user.type(screen.getByLabelText('agent-endpoint[web]'), 'https://alice.example')
    await user.click(screen.getByRole('button', { name: /save records/i }))

    expect(onSubmit).toHaveBeenCalledOnce()
    const arg = onSubmit.mock.calls[0]![0] as Record<string, string>
    expect(arg['agent-context']).toBe('{"name":"alice"}')
    expect(arg['agent-endpoint[web]']).toBe('https://alice.example')
    expect(arg['agent-endpoint[mcp]']).toBeUndefined()
  })

  it('submits ENSIP-18 profile keys as discrete records', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<RecordsForm initial={{}} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('name'), 'try-2 agent')
    await user.type(screen.getByLabelText('description'), 'Stealth-payment-enabled AI agent')
    await user.type(screen.getByLabelText('avatar'), 'https://example.com/avatar.png')
    await user.type(screen.getByLabelText('url'), 'https://github.com/HAPPYS1NGH/open-agents-stealth')
    await user.type(screen.getByLabelText('com.github'), 'HAPPYS1NGH')
    await user.click(screen.getByRole('button', { name: /save records/i }))

    expect(onSubmit).toHaveBeenCalledOnce()
    const arg = onSubmit.mock.calls[0]![0] as Record<string, string>
    expect(arg['name']).toBe('try-2 agent')
    expect(arg['description']).toBe('Stealth-payment-enabled AI agent')
    expect(arg['avatar']).toBe('https://example.com/avatar.png')
    expect(arg['url']).toBe('https://github.com/HAPPYS1NGH/open-agents-stealth')
    expect(arg['com.github']).toBe('HAPPYS1NGH')
    // ENSIP-26 keys absent because we didn't fill them.
    expect(arg['agent-context']).toBeUndefined()
  })

  it('rejects description longer than 160 chars (ENSIP-18)', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<RecordsForm initial={{}} onSubmit={onSubmit} />)

    const long = 'a'.repeat(161)
    await user.type(screen.getByLabelText('description'), long)
    await user.click(screen.getByRole('button', { name: /save records/i }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/description must be ≤160 chars/i)).toBeInTheDocument()
  })

  it('accepts ipfs:// avatar values', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<RecordsForm initial={{}} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('avatar'), 'ipfs://bafyabc123')
    await user.click(screen.getByRole('button', { name: /save records/i }))

    expect(onSubmit).toHaveBeenCalledOnce()
    const arg = onSubmit.mock.calls[0]![0] as Record<string, string>
    expect(arg['avatar']).toBe('ipfs://bafyabc123')
  })
})
