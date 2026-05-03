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
          description: 'A test agent',
        }}
        onSubmit={() => {}}
      />,
    )

    expect((screen.getByLabelText('agent-context (JSON)') as HTMLTextAreaElement).value)
      .toBe('{"name":"hi"}')
    expect((screen.getByLabelText('agent-endpoint[mcp]') as HTMLInputElement).value)
      .toBe('https://mybot.example/mcp')
    expect((screen.getByLabelText('name') as HTMLInputElement).value).toBe('My Agent')
    expect((screen.getByLabelText('description') as HTMLTextAreaElement).value).toBe('A test agent')
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

  it('submits ENSIP-18 profile keys (name/description/avatar) as discrete records', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<RecordsForm initial={{}} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('name'), 'try-2 agent')
    await user.type(screen.getByLabelText('description'), 'Stealth-payment-enabled AI agent')
    await user.type(screen.getByLabelText('avatar'), 'https://example.com/avatar.png')
    await user.click(screen.getByRole('button', { name: /save records/i }))

    expect(onSubmit).toHaveBeenCalledOnce()
    const arg = onSubmit.mock.calls[0]![0] as Record<string, string>
    expect(arg['name']).toBe('try-2 agent')
    expect(arg['description']).toBe('Stealth-payment-enabled AI agent')
    expect(arg['avatar']).toBe('https://example.com/avatar.png')
    // url / com.github / com.twitter intentionally absent — removed from form
    expect(arg['url']).toBeUndefined()
    expect(arg['com.github']).toBeUndefined()
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

  it('renders ENSIP-25 verification records read-only when present', () => {
    render(
      <RecordsForm
        initial={{
          'agent-registration[8453][46488]': '1',
          'agent-registration[0x000100000101148004a169fb4a3325136eb29fa0ceb6d2e539a432][167]': '1',
        }}
        onSubmit={() => {}}
      />,
    )

    expect(screen.getByText('Verification · ENSIP-25')).toBeInTheDocument()
    expect(screen.getByText('agent-registration[8453][46488]')).toBeInTheDocument()
    expect(screen.getByText(/registry: 8453/)).toBeInTheDocument()
    expect(screen.getByText(/agentId: 46488/)).toBeInTheDocument()
  })

  it('hides the Verification card when no ENSIP-25 records exist', () => {
    render(<RecordsForm initial={{ name: 'foo' }} onSubmit={() => {}} />)
    expect(screen.queryByText('Verification · ENSIP-25')).not.toBeInTheDocument()
  })
})
