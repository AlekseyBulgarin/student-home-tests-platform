import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/providers/auth-provider";
import { Skeleton } from "@/components/ui/skeleton";

const StudentFlow = lazy(() => import("@/pages/student-flow").then((module) => ({ default: module.StudentFlow })));
const TeacherDashboard = lazy(() => import("@/pages/teacher-dashboard").then((module) => ({ default: module.TeacherDashboard })));
const TeacherLogin = lazy(() => import("@/pages/teacher-login").then((module) => ({ default: module.TeacherLogin })));

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });

export function App() {
  return <QueryClientProvider client={queryClient}><AuthProvider><BrowserRouter><Suspense fallback={<div className="mx-auto flex max-w-3xl flex-col gap-4 p-8"><Skeleton className="h-16" /><Skeleton className="h-64" /></div>}><Routes>
    <Route path="/" element={<Navigate to="/teacher/login" replace />} />
    <Route path="/teacher/login" element={<TeacherLogin />} />
    <Route path="/teacher" element={<TeacherDashboard />} />
    <Route path="/a" element={<StudentFlow />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Suspense><Toaster richColors /></BrowserRouter></AuthProvider></QueryClientProvider>;
}
