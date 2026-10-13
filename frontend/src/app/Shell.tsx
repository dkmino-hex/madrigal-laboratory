import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useOutletContext, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowLeft,
  Braces,
  FileArchive,
  FlaskConical,
  GitCompareArrows,
  Lightbulb,
  ListChecks,
  ListTodo,
  Moon,
  Settings2,
  Sun,
  PanelLeftClose,
} from 'lucide-react';
import { api } from '../shared/api/client';
import { queryKey } from '../shared/api/query';
import type { Project } from '../shared/api/contracts/draft';
import { Badge, Banner, Button, Modal, QueryState } from '../shared/ui/common';
import { JobsCenter, JobCard, trackJob } from '../features/jobs/Jobs';
import { config } from './config';
import { readPreference, savePreference } from '../shared/lib/storage';
import { DevelopmentTools } from './DevelopmentTools';
import { ThemeContext } from './theme';

export function Shell() {
  const [theme, setTheme] = useState(readPreference('theme') ?? 'system');
  const [navigation, setNavigation] = useState(false);
  const [resolved, setResolved] = useState<'dark' | 'light'>('dark');
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      setResolved(resolved === 'light' ? 'light' : 'dark');
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', resolved === 'dark' ? '#191a20' : '#f4f5f7');
    };
    apply();
    savePreference('theme', theme);
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  return (
    <ThemeContext.Provider value={resolved}>
      <div className="app-shell" data-nav-open={navigation}>
        <a href="#main" className="skip-link">
          Перейти к содержимому
        </a>
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              М
            </span>
            <Link to="/projects">МАДРИГАЛ</Link>
            <span className="brand-detail">Лаборатория протоколов</span>
          </div>
          <div className="topbar-actions">
            <span className={'mode-label ' + config.mode}>
              {config.mode === 'mock' ? 'Демонстрационные данные' : 'Локальный Gateway · API'}
            </span>
            <Modal
              title="Центр заданий"
              description="Передача, анализ и сохранение. Отмена обработки подтверждается серверным статусом."
              trigger={
                <Button variant="ghost">
                  <ListTodo size={16} aria-hidden="true" />
                  <span>Задания</span>
                </Button>
              }
            >
              <JobsCenter />
            </Modal>
            <Button
              variant="ghost"
              aria-label="Переключить тему"
              onClick={() =>
                setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')
              }
            >
              {theme === 'light' ? (
                <Moon size={17} aria-hidden="true" />
              ) : (
                <Sun size={17} aria-hidden="true" />
              )}
            </Button>
            <Button
              variant="ghost"
              className="mobile-nav-toggle"
              aria-label="Открыть навигацию"
              aria-expanded={navigation}
              onClick={() => setNavigation(!navigation)}
            >
              <PanelLeftClose size={17} aria-hidden="true" />
            </Button>
          </div>
        </header>
        <Outlet />
        <DevelopmentTools />
      </div>
    </ThemeContext.Provider>
  );
}
const sections = [
  { path: '', label: 'Обзор проекта', icon: FlaskConical },
  { path: '/traffic', label: 'Обмен и байты', icon: Activity },
  { path: '/actions', label: 'Журнал действий', icon: ListTodo },
  { path: '/compare', label: 'Сравнение примеров', icon: GitCompareArrows },
  { path: '/interpretations', label: 'Интерпретации', icon: Braces },
  { path: '/hypotheses', label: 'Наблюдения и гипотезы', icon: Lightbulb },
  { path: '/runs', label: 'Проверки корпуса', icon: ListChecks },
  { path: '/artifacts', label: 'Отчёты и перенос', icon: FileArchive },
  { path: '/settings', label: 'Настройки проекта', icon: Settings2 },
];
export const useProject = () => useOutletContext<{ project: Project }>().project;
export function ProjectLayout() {
  const projectId = useParams().projectId!;
  const location = useLocation();
  const query = useQuery({
    queryKey: queryKey(projectId, 'project'),
    queryFn: ({ signal }) => api.project(projectId, { signal }),
  });
  const project = query.data;
  useEffect(() => {
    if (project?.jobId) trackJob(project.projectId, project.jobId);
  }, [project?.projectId, project?.jobId]);
  return (
    <div className="workspace-layout">
      <aside className="sidebar">
        <Link className="back-link" to="/projects">
          <ArrowLeft size={14} aria-hidden="true" />
          Все проекты
        </Link>
        <div className="project-label">
          <span className="muted">Рабочее пространство</span>
          <strong>{project?.name ?? 'Проект'}</strong>
          {project && <Badge status={project.status} />}
        </div>
        <nav aria-label="Разделы проекта">
          {sections.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              end={path === '' || path === '/runs'}
              to={'/projects/' + encodeURIComponent(projectId) + path}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="local-dot" aria-hidden="true" />
          Локальное исследование<small>Источники и версии сохраняются</small>
        </div>
      </aside>
      <main id="main" className="main-content">
        <QueryState
          pending={query.isPending}
          error={query.error}
          retry={() => void query.refetch()}
        >
          {project &&
            (project.status === 'READY' || location.pathname === '/projects/' + projectId ? (
              <Outlet key={projectId} context={{ project }} />
            ) : (
              <div>
                <h1>Проект ещё не готов</h1>
                <Banner tone="warning">
                  Исследование доступно после READY. {project.diagnostic}
                </Banner>
                {project.jobId && <JobCard projectId={projectId} jobId={project.jobId} />}
                <Button onClick={() => void query.refetch()}>Проверить готовность проекта</Button>
              </div>
            ))}
        </QueryState>
      </main>
    </div>
  );
}
