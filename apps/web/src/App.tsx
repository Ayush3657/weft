import { AuthProvider, useAuth } from './lib/auth'
import { navigate, parseRoute, useLocation } from './lib/router'
import { Toaster } from './lib/toast'
import { LoginPage } from './pages/LoginPage'
import { ProjectPage } from './pages/ProjectPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { Button, FullScreenMessage, Spinner, TooltipProvider } from './ui'

function Routes() {
  const { status, retry } = useAuth()
  const route = parseRoute(useLocation())
  if (status === 'loading') {
    return (
      <FullScreenMessage>
        <Spinner />
      </FullScreenMessage>
    )
  }
  if (status === 'unreachable') {
    return (
      <FullScreenMessage>
        <div className="max-w-sm">
          <h1 className="text-[16px] font-semibold text-fg">Can't reach the Weft server</h1>
          <p className="mt-1.5 text-fg-2">Make sure it's running. This page reconnects by itself when it's back.</p>
          <Button className="mt-4" onClick={retry}>
            Try again
          </Button>
        </div>
      </FullScreenMessage>
    )
  }
  if (status === 'signed-out') return <LoginPage />
  switch (route.name) {
    case 'projects':
      return <ProjectsPage />
    case 'project':
      return <ProjectPage projectId={route.projectId} workspace={route.workspace} write={route.write} popout={route.popout} />
    case 'not-found':
      return (
        <FullScreenMessage>
          <div>
            <h1 className="text-[16px] font-semibold text-fg">Nothing here</h1>
            <Button className="mt-4" onClick={() => navigate('/')}>
              All projects
            </Button>
          </div>
        </FullScreenMessage>
      )
  }
}

export function App() {
  return (
    <AuthProvider>
      <TooltipProvider delayDuration={400}>
        <Routes />
        <Toaster />
      </TooltipProvider>
    </AuthProvider>
  )
}
