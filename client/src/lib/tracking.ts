import { apiRequest } from '@/lib/queryClient';

// Activity tracking utility
export const trackActivity = async (activityType: string, activityData?: any) => {
  try {
    await apiRequest('/api/activity/track', 'POST', {
      activityType,
      activityData
    });
  } catch (error) {
    // Silently fail tracking - don't disrupt user experience
    console.log('Activity tracking note:', error);
  }
};

// Specific tracking functions
export const trackPageView = (path: string) => {
  trackActivity('page_view', { path });
};

export const trackSearch = (query: string, results: number) => {
  trackActivity('search', { query, results });
};

export const trackLogin = (userType: string) => {
  trackActivity('login', { userType });
};

export const trackUpload = (fileType: string, size: number) => {
  trackActivity('file_upload', { fileType, size });
};