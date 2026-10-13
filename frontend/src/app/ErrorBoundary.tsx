import { Component, type ReactNode } from 'react';
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="fatal">
        <h1>Не удалось открыть рабочую область</h1>
        <p>
          Сохранённые серверные версии не изменены. Обновите страницу; проверьте корректность прямой
          ссылки.
        </p>
        <button onClick={() => location.reload()}>Обновить страницу</button>
        <a href="/projects">Открыть проекты</a>
      </main>
    ) : (
      this.props.children
    );
  }
}
