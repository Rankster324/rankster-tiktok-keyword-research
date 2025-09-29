import type { Express } from "express";
import { createServer, type Server } from "http";
import { 
  insertEmailSubscriberSchema,
  insertCategorySchema,
  insertKeywordSchema,
  updateKeywordSchema,
  scrapeProductRequestSchema,
  chatRequestSchema,
  chatResponseSchema,
  optimizationStateSchema,
  insertAdClientSchema,
  insertAdCampaignSchema,
  insertOptimizationRecommendationSchema,
  insertCampaignResultSchema,
  insertTrainingMaterialSchema,
} from "@shared/schema";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, isAdmin } from "./replitAuth";
import { fromZodError } from "zod-validation-error";
import { z } from "zod";
import multer from "multer";
import crypto from "crypto";
import { scrapeProductFromUrl } from "./scraper";

// User activity tracking helper functions
function generateSessionId(): string {
  return crypto.randomUUID();
}

async function trackUserActivity(
  userId: string | null, 
  sessionId: string | null, 
  activityType: string, 
  activityData?: any
) {
  try {
    if (!sessionId) return;
    
    await storage.createUserActivity({
      userId: userId || undefined,
      sessionId,
      activityType,
      activityData: activityData ? JSON.stringify(activityData) : undefined,
    });
  } catch (error) {
    console.error('Error tracking user activity:', error);
  }
}

// Beehiiv API integration
async function addToBeehiivNewsletter(email: string, retryCount: number = 0): Promise<{ success: boolean; error?: string; statusCode?: number }> {
  try {
    const apiKey = process.env.BEEHIIV_API_KEY;
    const publicationId = process.env.BEEHIIV_PUBLICATION_ID;
    
    if (!apiKey || !publicationId) {
      const errorMsg = 'Beehiiv credentials not configured';
      console.error(`[BEEHIIV] ${errorMsg}`);
      return { success: false, error: errorMsg };
    }

    console.log(`[BEEHIIV] Attempting to add ${email} to newsletter (attempt ${retryCount + 1})`);

    const response = await fetch(`https://api.beehiiv.com/v2/publications/${publicationId}/subscriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email,
        reactivate_existing: false,
        send_welcome_email: true,
        utm_source: 'website',
        utm_medium: 'signup',
        utm_campaign: 'tiktok_keyword_tool'
      }),
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`[BEEHIIV] ✓ Successfully added ${email} to newsletter`);
      return { success: true };
    } else {
      const errorText = await response.text();
      const errorMsg = `API error ${response.status}: ${errorText}`;
      
      // Treat "already subscribed" responses as success for idempotency
      if (response.status === 409 || errorText.toLowerCase().includes('already subscribed')) {
        console.log(`[BEEHIIV] ✓ ${email} already subscribed (treating as success)`);
        return { success: true };
      }
      
      console.error(`[BEEHIIV] ✗ Failed to add ${email} - ${errorMsg}`);
      
      // Retry on certain status codes (rate limiting, server errors)
      if (retryCount < 2 && (response.status === 429 || response.status >= 500)) {
        const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
        console.log(`[BEEHIIV] Retrying ${email} in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return addToBeehiivNewsletter(email, retryCount + 1);
      }
      
      return { success: false, error: errorMsg, statusCode: response.status };
    }
  } catch (error) {
    const errorMsg = `Network/fetch error: ${error}`;
    console.error(`[BEEHIIV] ✗ Failed to add ${email} - ${errorMsg}`);
    
    // Retry on network errors
    if (retryCount < 2) {
      const delay = Math.pow(2, retryCount) * 1000;
      console.log(`[BEEHIIV] Retrying ${email} in ${delay}ms due to network error...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return addToBeehiivNewsletter(email, retryCount + 1);
    }
    
    return { success: false, error: errorMsg };
  }
}

// CSV upload helper functions removed - uploads now handled via Supabase



// CSV upload multer removed - uploads handled via Supabase directly

// Configure multer for training material uploads
const trainingMaterialUpload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'text/plain',
      'text/markdown',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    const allowedExtensions = ['.txt', '.md', '.pdf', '.doc', '.docx'];
    
    if (allowedTypes.includes(file.mimetype) || 
        allowedExtensions.some(ext => file.originalname.toLowerCase().endsWith(ext))) {
      cb(null, true);
    } else {
      cb(new Error('Only text, markdown, PDF, and Word documents are allowed'));
    }
  }
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup Replit Auth
  await setupAuth(app);

  // Session tracking middleware
  app.use('/api', async (req, res, next) => {
    try {
      // Get or create session ID
      let sessionId = (req.session as any).trackingSessionId;
      if (!sessionId) {
        sessionId = generateSessionId();
        (req.session as any).trackingSessionId = sessionId;
      }

      // Get user info from session (if logged in)
      const adminUser = (req.session as any).adminUser;
      const user = (req.session as any).user;
      const currentUser = adminUser || user;

      // Create or update user session
      if (currentUser && currentUser.id) {
        try {
          // Ensure user exists in database before creating session
          await storage.upsertUser({
            id: currentUser.id,
            email: currentUser.email,
            firstName: currentUser.firstName || 'User',
            lastName: currentUser.lastName || '',
            role: currentUser.role || 'user'
          });
          
          await storage.createUserSession({
            userId: currentUser.id,
            sessionId,
            userAgent: req.get('User-Agent') || 'Unknown',
            ipAddress: req.ip || req.connection.remoteAddress || 'Unknown',
          });
        } catch (error: any) {
          console.log('Session tracking note:', error.message);
        }
      }

      // Store session info for activity tracking
      (req as any).trackingSessionId = sessionId;
      (req as any).trackingUserId = currentUser?.id || null;

      next();
    } catch (error) {
      console.error('Session tracking error:', error);
      next(); // Continue even if tracking fails
    }
  });

  // Simple admin login endpoint
  app.post('/api/admin/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      console.log('Login attempt:', { email, password: password ? '***' : 'missing' });
      
      // Simple admin credentials (in production, use proper hashing)
      if (email === 'paul@rankster.co' && password === 'Hannah12') {
        // Ensure admin user exists in database first
        const dbUser = await storage.upsertUser({
          id: 'paul@rankster.co',
          email: 'paul@rankster.co',
          firstName: 'Paul',
          lastName: 'Admin',
          role: 'admin'
        });
        
        // Set session using the DB user data
        (req.session as any).adminUser = {
          id: dbUser.id,
          email: dbUser.email,
          role: 'admin',
          firstName: dbUser.firstName,
          lastName: dbUser.lastName
        };
        
        console.log('Session set:', (req.session as any).adminUser);
        await new Promise((resolve) => req.session.save(resolve));

        // Track login activity
        await trackUserActivity(
          'paul@rankster.co',
          (req as any).trackingSessionId,
          'admin_login',
          { email }
        );
        
        res.json({
          success: true,
          user: (req.session as any).adminUser
        });
      } else {
        console.log('Invalid credentials for:', email);
        res.status(401).json({ message: 'Invalid credentials' });
      }
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ message: 'Login failed' });
    }
  });

  // Check user session (both admin and regular users)
  app.get('/api/auth/user', async (req, res) => {
    try {
      console.log('Checking session:', req.session);
      
      // Check for admin session first
      const adminUser = (req.session as any)?.adminUser;
      console.log('Admin user from session:', adminUser);
      
      if (adminUser) {
        return res.json(adminUser);
      }

      // Check for regular user session
      const user = (req.session as any)?.user;
      console.log('Regular user from session:', user);
      
      if (user) {
        return res.json(user);
      }

      // Fallback to Replit Auth if available
      if (req.isAuthenticated && req.isAuthenticated() && req.user) {
        const userId = (req.user as any).claims?.sub;
        if (userId) {
          const authUser = await storage.getUser(userId);
          return res.json(authUser);
        }
      }

      res.status(401).json({ message: "Unauthorized" });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Admin logout
  app.post('/api/admin/logout', (req, res) => {
    (req.session as any).adminUser = null;
    res.json({ success: true });
  });

  // User logout endpoint
  app.post('/api/auth/logout', (req, res) => {
    (req.session as any).user = null;
    (req.session as any).adminUser = null;
    res.json({ success: true });
  });

  // Usage statistics endpoints for admin
  app.get('/api/admin/stats/daily', isAdmin, async (req, res) => {
    try {
      const days = req.query.days ? parseInt(req.query.days as string) : 30;
      const stats = await storage.getDailyUsageStats(days);
      res.json(stats);
    } catch (error) {
      console.error('Error getting daily stats:', error);
      res.status(500).json({ message: 'Failed to get daily usage statistics' });
    }
  });

  app.get('/api/admin/stats/weekly', isAdmin, async (req, res) => {
    try {
      const weeks = req.query.weeks ? parseInt(req.query.weeks as string) : 12;
      const stats = await storage.getWeeklyUsageStats(weeks);
      res.json(stats);
    } catch (error) {
      console.error('Error getting weekly stats:', error);
      res.status(500).json({ message: 'Failed to get weekly usage statistics' });
    }
  });

  app.get('/api/admin/stats/monthly', isAdmin, async (req, res) => {
    try {
      const months = req.query.months ? parseInt(req.query.months as string) : 12;
      const stats = await storage.getMonthlyUsageStats(months);
      res.json(stats);
    } catch (error) {
      console.error('Error getting monthly stats:', error);
      res.status(500).json({ message: 'Failed to get monthly usage statistics' });
    }
  });

  app.get('/api/admin/stats/activities', isAdmin, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? new Date(startDate as string) : undefined;
      const end = endDate ? new Date(endDate as string) : undefined;
      
      const activities = await storage.getActivityBreakdown(start, end);
      res.json(activities);
    } catch (error) {
      console.error('Error getting activity breakdown:', error);
      res.status(500).json({ message: 'Failed to get activity breakdown' });
    }
  });

  app.get('/api/admin/stats/overview', isAdmin, async (req, res) => {
    try {
      // Get overview stats for the last 30 days
      const dailyStats = await storage.getDailyUsageStats(30);
      const activityBreakdown = await storage.getActivityBreakdown();
      
      // Get actual email subscribers from the email_subscribers table
      const emailSubscribers = await storage.getEmailSubscribers();
      
      // Calculate totals
      const totalSessions = dailyStats.reduce((sum, day) => sum + day.sessions, 0);
      const totalActivities = dailyStats.reduce((sum, day) => sum + day.activities, 0);
      const uniqueEmailsSet = new Set(dailyStats.flatMap(day => day.emails));
      const totalUniqueUsers = uniqueEmailsSet.size;

      res.json({
        totalSessions,
        totalActivities,
        totalUniqueUsers,
        uniqueEmails: emailSubscribers.map(sub => sub.email), // Use actual email subscribers
        dailyStats: dailyStats.slice(0, 7), // Last 7 days for overview
        activityBreakdown: activityBreakdown.slice(0, 10), // Top 10 activities
      });
    } catch (error) {
      console.error('Error getting overview stats:', error);
      res.status(500).json({ message: 'Failed to get overview statistics' });
    }
  });

  // Admin endpoint to sync missing users to Beehiiv
  app.post('/api/admin/sync-beehiiv', isAdmin, async (req, res) => {
    try {
      console.log('[BEEHIIV SYNC] Starting sync process...');
      
      // Get all active email subscribers from local database
      const localSubscribers = await storage.getEmailSubscribers();
      console.log(`[BEEHIIV SYNC] Found ${localSubscribers.length} local subscribers to sync`);
      
      const results = {
        total: localSubscribers.length,
        success: 0,
        failed: 0,
        errors: [] as Array<{ email: string; error: string; statusCode?: number }>
      };

      // Sync each subscriber to Beehiiv with rate limiting
      for (let i = 0; i < localSubscribers.length; i++) {
        const subscriber = localSubscribers[i];
        console.log(`[BEEHIIV SYNC] Processing ${i + 1}/${localSubscribers.length}: ${subscriber.email}`);
        
        try {
          const result = await addToBeehiivNewsletter(subscriber.email);
          
          if (result.success) {
            results.success++;
          } else {
            results.failed++;
            results.errors.push({
              email: subscriber.email,
              error: result.error || 'Unknown error',
              statusCode: result.statusCode
            });
          }
        } catch (error) {
          results.failed++;
          results.errors.push({
            email: subscriber.email,
            error: `Unexpected error: ${error}`
          });
        }
        
        // Rate limiting: wait 100ms between requests to avoid overwhelming the API
        if (i < localSubscribers.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      console.log(`[BEEHIIV SYNC] Completed! Success: ${results.success}, Failed: ${results.failed}`);
      
      res.json({
        message: 'Beehiiv sync completed',
        results
      });
    } catch (error) {
      console.error('[BEEHIIV SYNC] Error during sync:', error);
      res.status(500).json({ 
        message: 'Failed to sync subscribers to Beehiiv',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Admin endpoint to test Beehiiv integration
  app.post('/api/admin/test-beehiiv', isAdmin, async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: 'Email is required for testing' });
      }
      
      console.log(`[BEEHIIV TEST] Testing integration with email: ${email}`);
      const result = await addToBeehiivNewsletter(email);
      
      res.json({
        message: 'Beehiiv test completed',
        success: result.success,
        error: result.error,
        statusCode: result.statusCode
      });
    } catch (error) {
      console.error('[BEEHIIV TEST] Error during test:', error);
      res.status(500).json({ 
        message: 'Failed to test Beehiiv integration',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Activity tracking endpoint for frontend
  app.post('/api/activity/track', async (req, res) => {
    try {
      const { activityType, activityData } = req.body;
      
      if (!activityType) {
        return res.status(400).json({ message: 'Activity type is required' });
      }

      // Track the activity
      await trackUserActivity(
        (req as any).trackingUserId,
        (req as any).trackingSessionId,
        activityType,
        activityData || {}
      );

      res.json({ success: true });
    } catch (error) {
      console.error('Error tracking activity:', error);
      res.status(500).json({ message: 'Failed to track activity' });
    }
  });

  // Authentication middleware for regular users
  const isAuthenticatedUser = (req: any, res: any, next: any) => {
    const user = (req.session as any)?.user;
    const adminUser = (req.session as any)?.adminUser;
    
    if (user || adminUser) {
      return next();
    }
    
    return res.status(401).json({ message: "Please sign in to access this tool" });
  };

  // User signup endpoint for email authentication
  app.post('/api/auth/signup', async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ message: 'Email is required' });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: 'Invalid email format' });
      }

      // Create or find user account
      const userData = {
        id: email, // Use email as ID for simplicity
        email: email,
        firstName: null,
        lastName: null,
        profileImageUrl: null,
        role: 'user' as const,
      };

      const user = await storage.upsertUser(userData);

      // Add to local newsletter database and Beehiiv
      try {
        const existingSubscriber = await storage.getEmailSubscriber(email);
        if (!existingSubscriber) {
          // Add to local database
          await storage.createEmailSubscriber({ 
            email: email
          });
        }
        
        // Always try to add to Beehiiv newsletter (handles duplicates gracefully)
        const beehiivResult = await addToBeehiivNewsletter(email);
        if (beehiivResult.success) {
          console.log('User successfully subscribed to Beehiiv newsletter:', email);
        } else {
          console.error(`Failed to add ${email} to Beehiiv:`, beehiivResult.error);
        }
      } catch (error) {
        console.log('Newsletter subscription error (non-fatal):', error);
      }

      // Set user session
      (req.session as any).user = {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName
      };
      
      await new Promise((resolve) => req.session.save(resolve));

      res.json({
        success: true,
        user: (req.session as any).user
      });
    } catch (error) {
      console.error('Signup error:', error);
      res.status(500).json({ message: 'Signup failed' });
    }
  });

  // Email subscription endpoint
  app.post("/api/subscribe", async (req, res) => {
    try {
      const { email } = insertEmailSubscriberSchema.parse(req.body);
      
      // Check if email already exists
      const existingSubscriber = await storage.getEmailSubscriber(email);
      if (existingSubscriber) {
        return res.status(400).json({ 
          message: "Email already subscribed",
          success: false 
        });
      }

      // Create new subscriber
      const subscriber = await storage.createEmailSubscriber({ email });
      
      // Also add to Beehiiv newsletter
      try {
        const beehiivResult = await addToBeehiivNewsletter(email);
        if (beehiivResult.success) {
          console.log('Newsletter subscriber also added to Beehiiv:', email);
        } else {
          console.error(`Failed to add ${email} to Beehiiv newsletter:`, beehiivResult.error);
        }
      } catch (error) {
        console.log('Beehiiv newsletter addition error (non-fatal):', error);
      }
      
      res.json({ 
        message: "Successfully subscribed to Rankster newsletter",
        success: true,
        subscriber: { email: subscriber.email, subscribedAt: subscriber.subscribedAt }
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid email address",
          success: false 
        });
      }
      
      res.status(500).json({ 
        message: "Internal server error",
        success: false 
      });
    }
  });

  // Get subscriber count
  app.get("/api/subscriber-count", async (req, res) => {
    try {
      const count = await storage.getEmailSubscribersCount();
      res.json({ count });
    } catch (error) {
      res.status(500).json({ 
        message: "Internal server error",
        count: 0 
      });
    }
  });

  // Public category routes
  app.get("/api/categories", async (req, res) => {
    try {
      const parentId = req.query.parentId as string | undefined;
      const searchMetric = req.query.searchMetric as string | undefined;
      
      let categories = await storage.getCategoriesByParent(parentId || null);
      
      // For HPK data, return only the actual categories from HPK uploads
      if (searchMetric === 'high-potential') {
        categories = await storage.getCategoriesWithHpkData();
      }
      
      // For RK data, return only the actual categories from RK uploads
      if (searchMetric === 'rising') {
        categories = await storage.getCategoriesWithRkData();
      }
      
      res.json(categories);
    } catch (error) {
      console.error("Error fetching categories:", error);
      res.status(500).json({ message: "Failed to fetch categories" });
    }
  });

  // Categories with keyword counts - add caching headers
  app.get("/api/categories/with-counts", async (req, res) => {
    try {
      const { uploadPeriod, searchMetric } = req.query;
      
      // Set cache headers for categories (they don't change often)
      res.set({
        'Cache-Control': 'public, max-age=600, stale-while-revalidate=1800', // 10min cache, 30min stale
        'ETag': `categories-v4-${uploadPeriod || 'all'}-${searchMetric || 'regular'}`
      });
      
      const categories = await storage.getCategoriesWithKeywordCounts(
        uploadPeriod as string,
        searchMetric as string
      );
      
      // Get total unique keywords count (same logic as search API to ensure consistency)
      const totalUniqueKeywords = await storage.getTotalKeywordsCount(
        uploadPeriod as string,
        searchMetric as string
      );
      
      const response = {
        categories: categories,
        totalUniqueKeywords: totalUniqueKeywords
      };
      

      
      res.json(response);
    } catch (error) {
      console.error("Error fetching categories with counts:", error);
      res.status(500).json({ message: "Failed to fetch categories with counts" });
    }
  });

  // Keyword search route - temporarily open access for debugging
  app.get("/api/keywords/search", async (req, res) => {
    try {
      const { q, query, category, subCategory1, subCategory2, uploadPeriod, page, limit, sortFields, sortDirections, searchMetric } = req.query;
      const searchQuery = (q || query) as string;
      const uploadPeriodStr = uploadPeriod as string;
      const searchMetricStr = searchMetric as string || 'top';
      
      // DEBUG: Log the upload period filter
      console.log("Search API - Upload Period Filter:", uploadPeriodStr);
      console.log("Search API - All query params:", req.query);
      
      // Pagination parameters
      const pageNum = page ? parseInt(page as string) : 1;
      const pageSize = limit ? parseInt(limit as string) : 20; // Default to 20 per page
      const offset = (pageNum - 1) * pageSize;
      
      // Multi-column sorting parameters
      const sortFieldsStr = sortFields as string;
      const sortDirectionsStr = sortDirections as string;
      
      // Set appropriate cache headers based on query type
      const cacheSeconds = searchQuery ? 120 : 300; // 2min for search, 5min for category browse
      res.set({
        'Cache-Control': `public, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`,
        'Vary': 'Accept-Encoding' // Enable compression-aware caching
      });
      
      // Handle search requests - either keyword search or category browsing
      const result = await storage.searchKeywordsWithPagination(
        searchQuery || '', 
        category as string, 
        subCategory1 as string, 
        subCategory2 as string, 
        uploadPeriodStr,
        pageSize,
        offset,
        sortFieldsStr,
        sortDirectionsStr,
        searchMetricStr
      );

      // Track search activity
      await trackUserActivity(
        (req as any).trackingUserId,
        (req as any).trackingSessionId,
        'search',
        {
          query: searchQuery,
          category,
          searchMetric: searchMetricStr,
          results: result.total,
          page: pageNum
        }
      );
      
      res.json({
        keywords: result.keywords,
        pagination: {
          page: pageNum,
          pageSize: pageSize,
          total: result.total,
          totalPages: Math.ceil(result.total / pageSize),
          hasNext: pageNum * pageSize < result.total,
          hasPrev: pageNum > 1
        }
      });
    } catch (error) {
      console.error("Error searching keywords:", error);
      res.status(500).json({ message: "Failed to search keywords" });
    }
  });

  // Admin-only routes for data management
  app.get("/api/admin/categories", isAdmin, async (req, res) => {
    try {
      const categories = await storage.getCategories();
      res.json(categories);
    } catch (error) {
      console.error("Error fetching categories:", error);
      res.status(500).json({ message: "Failed to fetch categories" });
    }
  });

  app.post("/api/admin/categories", isAdmin, async (req, res) => {
    try {
      const validatedData = insertCategorySchema.parse(req.body);
      const category = await storage.createCategory(validatedData);
      res.status(201).json(category);
    } catch (error: any) {
      if (error.name === "ZodError") {
        const validationError = fromZodError(error);
        return res.status(400).json({ message: validationError.toString() });
      }
      console.error("Error creating category:", error);
      res.status(500).json({ message: "Failed to create category" });
    }
  });

  app.get("/api/admin/keywords", isAdmin, async (req, res) => {
    try {
      const { limit, search, categoryId, uploadPeriod } = req.query;
      const keywords = await storage.getKeywords(
        limit ? parseInt(limit as string) : undefined,
        search as string,
        categoryId as string,
        uploadPeriod as string
      );
      res.json(keywords);
    } catch (error) {
      console.error("Error fetching keywords:", error);
      res.status(500).json({ message: "Failed to fetch keywords" });
    }
  });

  app.post("/api/admin/keywords", isAdmin, async (req, res) => {
    try {
      const validatedData = insertKeywordSchema.parse(req.body);
      const keyword = await storage.createKeyword(validatedData);
      res.status(201).json(keyword);
    } catch (error: any) {
      if (error.name === "ZodError") {
        const validationError = fromZodError(error);
        return res.status(400).json({ message: validationError.toString() });
      }
      console.error("Error creating keyword:", error);
      res.status(500).json({ message: "Failed to create keyword" });
    }
  });

  app.put("/api/admin/keywords/:id", isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = updateKeywordSchema.parse(req.body);
      const keyword = await storage.updateKeyword(id, validatedData);
      res.json(keyword);
    } catch (error: any) {
      if (error.name === "ZodError") {
        const validationError = fromZodError(error);
        return res.status(400).json({ message: validationError.toString() });
      }
      console.error("Error updating keyword:", error);
      res.status(500).json({ message: "Failed to update keyword" });
    }
  });

  app.delete("/api/admin/keywords/:id", isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteKeyword(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting keyword:", error);
      res.status(500).json({ message: "Failed to delete keyword" });
    }
  });

  // CSV Upload endpoints removed - Keywords are now uploaded directly to Supabase
  // Use Supabase Dashboard to upload CSV files to the keywords table

  // Add 410 Gone responses for backward compatibility
  app.post("/api/admin/keywords/upload-csv", isAdmin, (req, res) => {
    res.status(410).json({ 
      message: "CSV upload endpoint removed. Please upload CSV files directly to Supabase using the dashboard." 
    });
  });

  // HPK Upload endpoint removed - Upload HPK files directly to Supabase
  app.post("/api/admin/keywords/upload-hpk", isAdmin, (req, res) => {
    res.status(410).json({ 
      message: "HPK upload endpoint removed. Please upload HPK CSV files directly to Supabase using the dashboard." 
    });
  });
      }

      // Validate HPK filename format - now supports weekly data (YYYYMMDD)
      const filename = req.file.originalname.toLowerCase();
      if (!filename.startsWith('hpk-') || !filename.endsWith('.csv')) {
        return res.status(400).json({ 
          message: "HPK files must follow the format: HPK-YYYYMMDD.csv (e.g., HPK-20250714.csv)" 
        });
      }

      // Extract period from HPK filename (e.g., HPK-20250714.csv -> 2025-07)
      const hpkPattern = /hpk-(\d{4})(\d{2})(\d{2})\.csv$/;
      const match = filename.match(hpkPattern);
      
      if (!match) {
        return res.status(400).json({ 
          message: "Invalid HPK filename format. Use HPK-YYYYMMDD.csv (e.g., HPK-20250714.csv)" 
        });
      }

      // Keep weekly date format for HPK data (YYYY-MM-DD format)
      const uploadPeriod = `${match[1]}-${match[2]}-${match[3]}`;
      console.log(`HPK upload period (derived from weekly file): ${uploadPeriod}`);

      // Parse CSV data using same logic as regular upload
      const csvContent = req.file.buffer.toString('utf8');
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      if (!Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ message: "HPK file is empty or invalid" });
      }
      
      console.log(`HPK file contains ${records.length} records`);

      // HPK-specific column mapping (different from regular CSV)
      const firstRecord = records[0] as Record<string, any>;
      const csvHeaders = Object.keys(firstRecord);
      console.log('HPK CSV headers:', csvHeaders);
      
      // HPK files have: Date, Category, Sub Category 1, Sub Category 2, Keyword, Opportunity score, Search volume, Available products
      // Map the database fields to the exact CSV column names (case-insensitive)
      const hpkDirectMapping: Record<string, string[]> = {
        date: ['Date', 'date', 'Date Range', 'date_range', 'daterange', 'period'],
        category: ['Category', 'category', 'cat', 'categories'],
        subCategory1: ['Sub Category 1', 'sub_category_1', 'sub category 1', 'subcategory1', 'subcategory 1'],
        subCategory2: ['Sub Category 2', 'sub_category_2', 'sub category 2', 'subcategory2', 'subcategory 2'],
        keyword: ['Keyword', 'keyword', 'kw', 'keywords'], 
        skuSalesScore: ['Opportunity score', 'opportunity_score', 'opportunity score', 'opportunityscore', 'opp_score', 'opp score'],
        searchVolume: ['Search volume', 'search_volume', 'search volume', 'searchvolume', 'volume', 'search'],
        availableProducts: ['Available products', 'available_products', 'available products', 'availableproducts', 'products', 'available']
      };

      const mappedColumns: Record<string, string> = {};
      for (const [key, possibleHeaders] of Object.entries(hpkDirectMapping)) {
        let found = false;
        for (const headerPattern of possibleHeaders) {
          // Try exact match first (case-sensitive)
          let foundHeader = csvHeaders.find(h => h === headerPattern);
          
          // If no exact match, try case-insensitive
          if (!foundHeader) {
            foundHeader = csvHeaders.find(h => h.toLowerCase() === headerPattern.toLowerCase());
          }
          
          // If still no match, try normalized matching (remove spaces/underscores)
          if (!foundHeader) {
            const normalizeStr = (str: string) => str.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
            foundHeader = csvHeaders.find(h => normalizeStr(h) === normalizeStr(headerPattern));
          }
          
          if (foundHeader) {
            mappedColumns[key] = foundHeader;
            console.log(`HPK mapped ${key} -> ${foundHeader} (pattern: ${headerPattern})`);
            found = true;
            break; // Found a match, stop looking for other patterns
          }
        }
        if (!found) {
          console.log(`HPK WARNING: Could not find column for ${key}. Tried patterns: [${possibleHeaders.join(', ')}]`);
          console.log(`Available headers: [${csvHeaders.join(', ')}]`);
        }
      }

      // Load all categories once to avoid repeated DB calls
      const allCategories = await storage.getCategories();
      const categoryCache = new Map<string, string>();
      
      // Validate and process records
      const validatedRecords: any[] = [];
      const errors: string[] = [];

      for (let i = 0; i < records.length; i++) {
        const record = records[i] as Record<string, any>;
        
        try {
          const keyword = record[mappedColumns.keyword]?.toString().trim();
          if (!keyword) {
            errors.push(`Row ${i + 2}: Missing keyword`);
            continue;
          }

          // Parse date range from CSV
          const dateRangeStr = record[mappedColumns.date]?.toString().trim();
          let parsedDateInfo = null;
          if (dateRangeStr) {
            parsedDateInfo = parseDateRange(dateRangeStr);
            if (!parsedDateInfo) {
              errors.push(`Row ${i + 2}: Invalid date format: ${dateRangeStr}`);
              continue;
            }
          }
          
          // Extract category and subcategory information
          const categoryName = record[mappedColumns.category]?.toString().trim() || 'Uncategorized';
          const subCategory1 = record[mappedColumns.subCategory1]?.toString().trim() || null;
          const subCategory2 = record[mappedColumns.subCategory2]?.toString().trim() || null;
          
          let categoryId = null;
          // Check cache first
          if (categoryCache.has(categoryName)) {
            categoryId = categoryCache.get(categoryName)!;
          } else {
            // Find existing category
            const existingCategory = allCategories.find(cat => cat.name === categoryName);
            
            if (existingCategory) {
              categoryId = existingCategory.id;
              categoryCache.set(categoryName, categoryId);
            } else {
              const newCategory = await storage.createCategory({
                name: categoryName,
                parentId: null
              });
              categoryId = newCategory.id;
              categoryCache.set(categoryName, categoryId);
              // Add to our local categories list too
              allCategories.push(newCategory);
            }
          }

          // HPK specific data mapping with new date range and subcategory support
          const keywordData = {
            keyword,
            searchVolume: parseInt(String(record[mappedColumns.searchVolume] || '0').replace(/[$,]/g, '')) || 0,
            productClickScore: '0', // Not in HPK files
            skuSalesScore: record[mappedColumns.skuSalesScore]?.toString() || '0', // This is the Opportunity Score
            availableProducts: parseInt(String(record[mappedColumns.availableProducts] || '0').replace(/[$,]/g, '')) || 0,
            averagePrice: '0', // Not in HPK files
            ctrScore: '0', // Not in HPK files
            ctorScore: '0', // Not in HPK files
            categoryId,
            category: categoryName, // Include the category name for frontend display
            subCategory1: subCategory1, // Include subcategories
            subCategory2: subCategory2,
            // Use parsed date information if available, fallback to filename-based upload period
            startDate: parsedDateInfo?.startDate || null,
            endDate: parsedDateInfo?.endDate || null,
            uploadPeriod: parsedDateInfo?.uploadPeriod || uploadPeriod, // Use parsed or fallback
            isActive: true,
            isHpk: true // Mark as HPK keyword
          };

          const validation = insertKeywordSchema.safeParse(keywordData);
          if (!validation.success) {
            const error = fromZodError(validation.error);
            errors.push(`Row ${i + 2}: ${error.message}`);
            continue;
          }

          validatedRecords.push(validation.data);
        } catch (error: any) {
          errors.push(`Row ${i + 2}: ${error.message}`);
        }
      }

      // First, deactivate any existing HPK data for this period to avoid duplicates
      console.log(`Deactivating existing HPK data for period ${uploadPeriod}`);
      const deactivatedCount = await storage.deleteUploadPeriod(uploadPeriod, 'hpk');
      console.log(`Deactivated ${deactivatedCount} existing HPK records for period ${uploadPeriod}`);

      // Batch insert HPK keywords
      console.log(`Processing ${validatedRecords.length} validated HPK records`);
      let importedCount = 0;
      const batchSize = 100;
      
      for (let i = 0; i < validatedRecords.length; i += batchSize) {
        const batch = validatedRecords.slice(i, i + batchSize);
        console.log(`Processing HPK batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(validatedRecords.length / batchSize)}`);
        
        try {
          await storage.createKeywordsBatch(batch);
          importedCount += batch.length;
        } catch (error: any) {
          console.error(`HPK batch insert error:`, error);
          errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
        }
      }
      
      console.log(`HPK upload completed: ${importedCount} imported`);

      const response: any = {
        imported: importedCount,
        total: records.length,
        message: `Successfully imported ${importedCount} out of ${records.length} HPK keywords`
      };

      if (errors.length > 0) {
        response.errors = errors.slice(0, 10);
        if (errors.length > 10) {
          response.errors.push(`... and ${errors.length - 10} more errors`);
        }
      }

      res.json(response);
    } catch (error: any) {
      console.error("HPK upload error:", error);
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: "File size too large. Maximum 10MB allowed." });
      }
      res.status(500).json({ 
        message: "Failed to process HPK file", 
        error: error.message 
      });
    }
  });

  // RK Upload endpoint removed - Upload RK files directly to Supabase
  app.post("/api/admin/keywords/upload-rk", isAdmin, (req, res) => {
    res.status(410).json({ 
      message: "RK upload endpoint removed. Please upload RK CSV files directly to Supabase using the dashboard." 
    });
  });
    req.setTimeout(5 * 60 * 1000);
    res.setTimeout(5 * 60 * 1000);
    
    console.log("RK upload started");
    
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No RK file uploaded" });
      }

      // Validate RK filename format
      const filename = req.file.originalname.toLowerCase();
      if (!filename.startsWith('rk-') || !filename.endsWith('.csv')) {
        return res.status(400).json({ 
          message: "RK files must follow the format: RK-YYYYMM.csv or RK-YYYYMM_suffix.csv (e.g., RK-202508.csv)" 
        });
      }

      // Extract period from RK filename (e.g., RK-202508.csv or RK-202508_timestamp.csv -> 2025-08)
      const rkPattern = /rk-(\d{4})(\d{2})(?:_.*)?\.csv$/;
      const match = filename.match(rkPattern);
      
      if (!match) {
        return res.status(400).json({ 
          message: "Invalid RK filename format. Use RK-YYYYMM.csv or RK-YYYYMM_suffix.csv (e.g., RK-202508.csv)" 
        });
      }

      const uploadPeriod = `${match[1]}-${match[2]}`;
      console.log(`RK upload period: ${uploadPeriod}`);

      // Parse CSV data
      const csvContent = req.file.buffer.toString('utf8');
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      if (!Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ message: "RK file is empty or invalid" });
      }
      
      console.log(`RK file contains ${records.length} records`);

      // RK-specific column mapping - all 10 columns
      const firstRecord = records[0] as Record<string, any>;
      const csvHeaders = Object.keys(firstRecord);
      console.log('RK CSV headers:', csvHeaders);
      
      // RK files have: Date, Category, Sub Category 1, Sub Category 2, Rank, Keyword, Search volume, Product click score, SKU sales score, Available products, Avg. price, CTR score, CTOR score
      const rkDirectMapping: Record<string, string[]> = {
        date: ['Date', 'date', 'Date Range', 'date_range', 'daterange', 'period'],
        category: ['Category', 'category', 'cat', 'categories'],
        subCategory1: ['Sub Category 1', 'sub_category_1', 'sub category 1', 'subcategory1', 'subcategory 1'],
        subCategory2: ['Sub Category 2', 'sub_category_2', 'sub category 2', 'subcategory2', 'subcategory 2'],
        rank: ['Rank', 'rank', 'ranking', '#', 'position'],
        keyword: ['Keyword', 'keyword', 'kw', 'keywords'], 
        searchVolume: ['Search volume', 'search_volume', 'search volume', 'searchvolume', 'volume', 'search'],
        productClickScore: ['Product click score', 'product_click_score', 'product click score', 'productclickscore', 'pcs', 'click score'],
        skuSalesScore: ['SKU sales score', 'sku_sales_score', 'sku sales score', 'skusalesscore', 'sss', 'sales score'],
        availableProducts: ['Available products', 'available_products', 'available products', 'availableproducts', 'products', 'available'],
        averagePrice: ['Avg. price', 'avg_price', 'avg price', 'avgprice', 'average price', 'price'],
        ctrScore: ['CTR score', 'ctr_score', 'ctr score', 'ctrscore', 'ctr'],
        ctorScore: ['CTOR score', 'ctor_score', 'ctor score', 'ctorscore', 'ctor']
      };

      const mappedColumns: Record<string, string> = {};
      for (const [key, possibleHeaders] of Object.entries(rkDirectMapping)) {
        let found = false;
        for (const headerPattern of possibleHeaders) {
          // Try exact match first (case-sensitive)
          let foundHeader = csvHeaders.find(h => h === headerPattern);
          
          // If no exact match, try case-insensitive
          if (!foundHeader) {
            foundHeader = csvHeaders.find(h => h.toLowerCase() === headerPattern.toLowerCase());
          }
          
          // If still no match, try normalized matching (remove spaces/underscores)
          if (!foundHeader) {
            const normalizeStr = (str: string) => str.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
            foundHeader = csvHeaders.find(h => normalizeStr(h) === normalizeStr(headerPattern));
          }
          
          if (foundHeader) {
            mappedColumns[key] = foundHeader;
            console.log(`RK mapped ${key} -> ${foundHeader} (pattern: ${headerPattern})`);
            found = true;
            break; // Found a match, stop looking for other patterns
          }
        }
        if (!found) {
          console.log(`RK WARNING: Could not find column for ${key}. Tried patterns: [${possibleHeaders.join(', ')}]`);
          console.log(`Available headers: [${csvHeaders.join(', ')}]`);
        }
      }

      // Load all categories once to avoid repeated DB calls
      const allCategories = await storage.getCategories();
      const categoryCache = new Map<string, string>();
      
      // Validate and process records
      const validatedRecords: any[] = [];
      const errors: string[] = [];

      for (let i = 0; i < records.length; i++) {
        const record = records[i] as Record<string, any>;
        
        try {
          const keyword = record[mappedColumns.keyword]?.toString().trim();
          if (!keyword) {
            errors.push(`Row ${i + 2}: Missing keyword`);
            continue;
          }

          // Parse date range from CSV if available
          let parsedDateInfo = null;
          if (mappedColumns.date) {
            const dateRangeStr = record[mappedColumns.date]?.toString().trim();
            if (dateRangeStr) {
              parsedDateInfo = parseDateRange(dateRangeStr);
              if (!parsedDateInfo) {
                errors.push(`Row ${i + 2}: Invalid date format: ${dateRangeStr}`);
                continue;
              }
            }
          }
          
          // Extract category and subcategory information
          const categoryName = record[mappedColumns.category]?.toString().trim() || 'Uncategorized';
          const subCategory1 = record[mappedColumns.subCategory1]?.toString().trim() || null;
          const subCategory2 = record[mappedColumns.subCategory2]?.toString().trim() || null;
          
          let categoryId = null;
          // Check cache first
          if (categoryCache.has(categoryName)) {
            categoryId = categoryCache.get(categoryName)!;
          } else {
            // Find existing category
            const existingCategory = allCategories.find(cat => cat.name === categoryName);
            
            if (existingCategory) {
              categoryId = existingCategory.id;
              categoryCache.set(categoryName, categoryId);
            } else {
              const newCategory = await storage.createCategory({
                name: categoryName,
                parentId: null
              });
              categoryId = newCategory.id;
              categoryCache.set(categoryName, categoryId);
              // Add to our local categories list too
              allCategories.push(newCategory);
            }
          }

          // RK specific data mapping with new date range and subcategory support
          const keywordData = {
            keyword,
            rank: parseInt(String(record[mappedColumns.rank] || '0').replace(/[$,]/g, '')) || 0,
            searchVolume: parseInt(String(record[mappedColumns.searchVolume] || '0').replace(/[$,]/g, '')) || 0,
            productClickScore: String(record[mappedColumns.productClickScore] || '0').replace(/[$,]/g, ''),
            skuSalesScore: String(record[mappedColumns.skuSalesScore] || '0').replace(/[$,]/g, ''),
            availableProducts: parseInt(String(record[mappedColumns.availableProducts] || '0').replace(/[$,]/g, '')) || 0,
            averagePrice: String(record[mappedColumns.averagePrice] || '0').replace(/[$,]/g, ''),
            ctrScore: String(record[mappedColumns.ctrScore] || '0').replace(/[$,]/g, ''),
            ctorScore: String(record[mappedColumns.ctorScore] || '0').replace(/[$,]/g, ''),
            categoryId,
            category: categoryName, // Include the category name for frontend display
            subCategory1: subCategory1, // Include subcategories
            subCategory2: subCategory2,
            // Use parsed date information if available, fallback to filename-based upload period
            startDate: parsedDateInfo?.startDate || null,
            endDate: parsedDateInfo?.endDate || null,
            uploadPeriod: parsedDateInfo?.uploadPeriod || uploadPeriod, // Use parsed or fallback
            isActive: true,
            isRk: true // Mark as RK keyword
          };

          const validation = insertKeywordSchema.safeParse(keywordData);
          if (!validation.success) {
            const error = fromZodError(validation.error);
            errors.push(`Row ${i + 2}: ${error.message}`);
            continue;
          }

          validatedRecords.push(validation.data);
        } catch (error: any) {
          errors.push(`Row ${i + 2}: ${error.message}`);
        }
      }

      // First, deactivate any existing RK data for this period to avoid duplicates
      console.log(`Deactivating existing RK data for period ${uploadPeriod}`);
      const deactivatedCount = await storage.deleteUploadPeriod(uploadPeriod, 'rk');
      console.log(`Deactivated ${deactivatedCount} existing RK records for period ${uploadPeriod}`);

      // Batch insert RK keywords
      console.log(`Processing ${validatedRecords.length} validated RK records`);
      let importedCount = 0;
      const batchSize = 100;
      
      for (let i = 0; i < validatedRecords.length; i += batchSize) {
        const batch = validatedRecords.slice(i, i + batchSize);
        console.log(`Processing RK batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(validatedRecords.length / batchSize)}`);
        
        try {
          await storage.createKeywordsBatch(batch);
          importedCount += batch.length;
        } catch (error: any) {
          console.error(`RK batch insert error:`, error);
          errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
        }
      }
      
      console.log(`RK upload completed: ${importedCount} imported`);

      const response: any = {
        imported: importedCount,
        total: records.length,
        message: `Successfully imported ${importedCount} out of ${records.length} RK keywords`
      };

      if (errors.length > 0) {
        response.errors = errors.slice(0, 10);
        if (errors.length > 10) {
          response.errors.push(`... and ${errors.length - 10} more errors`);
        }
      }

      res.json(response);
    } catch (error: any) {
      console.error("RK upload error:", error);
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: "File size too large. Maximum 10MB allowed." });
      }
      res.status(500).json({ 
        message: "Failed to process RK file", 
        error: error.message 
      });
    }
  });

  // Upload management endpoints
  app.get("/api/admin/uploads", isAdmin, async (req, res) => {
    try {
      const uploads = await storage.getUploadPeriods();
      res.json(uploads);
    } catch (error: any) {
      console.error("Error fetching uploads:", error);
      res.status(500).json({ message: "Failed to fetch uploads", error: error.message });
    }
  });

  // Get available periods for HPK searches based on actual uploads
  app.get("/api/keywords/hpk-periods", async (req, res) => {
    try {
      const periods = await storage.getAvailableHpkPeriods();
      res.json(periods);
    } catch (error: any) {
      console.error("Error fetching HPK periods:", error);
      res.status(500).json({ message: "Failed to fetch HPK periods", error: error.message });
    }
  });

  // Get available periods for RK searches based on actual uploads
  app.get("/api/keywords/rk-periods", async (req, res) => {
    try {
      const periods = await storage.getAvailableRkPeriods();
      res.json(periods);
    } catch (error: any) {
      console.error("Error fetching RK periods:", error);
      res.status(500).json({ message: "Failed to fetch RK periods", error: error.message });
    }
  });

  // Get available periods for regular keyword searches based on actual uploads
  app.get("/api/keywords/regular-periods", async (req, res) => {
    try {
      const periods = await storage.getAvailableRegularPeriods();
      res.json(periods);
    } catch (error: any) {
      console.error("Error fetching regular periods:", error);
      res.status(500).json({ message: "Failed to fetch regular periods", error: error.message });
    }
  });

  app.delete("/api/admin/uploads/:period/:type", isAdmin, async (req, res) => {
    try {
      const { period, type } = req.params;
      
      // Validate upload type
      if (!['regular', 'hpk', 'rk'].includes(type)) {
        return res.status(400).json({ message: "Invalid upload type. Must be 'regular', 'hpk', or 'rk'" });
      }

      const deletedCount = await storage.deleteUploadPeriod(period, type as 'regular' | 'hpk' | 'rk');
      
      res.json({ 
        message: `Successfully deleted ${deletedCount} ${type.toUpperCase()} keywords from period ${period}`,
        deletedCount,
        period,
        type
      });
    } catch (error: any) {
      console.error("Error deleting upload:", error);
      res.status(500).json({ message: "Failed to delete upload", error: error.message });
    }
  });

  // Contact form submission
  app.post("/api/contact", async (req, res) => {
    try {
      const { name, email, subject, message } = req.body;
      
      if (!name || !email || !message) {
        return res.status(400).json({ message: "Name, email, and message are required" });
      }

      // Here you could integrate with SendGrid or similar service
      // For now, we'll just log the contact submission
      console.log("Contact form submission:", { name, email, subject, message });
      
      // In production, you would send an email to paul@rankster.co
      // using SendGrid or similar email service
      
      res.json({ 
        success: true, 
        message: "Message sent successfully" 
      });
    } catch (error: any) {
      console.error("Error processing contact form:", error);
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  // Simple in-memory rate limiter for AI endpoint
  const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
  const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
  const RATE_LIMIT_MAX_REQUESTS = 3; // 3 requests per minute per IP

  const checkRateLimit = (ip: string): boolean => {
    const now = Date.now();
    const record = rateLimitMap.get(ip);
    
    if (!record || now > record.resetTime) {
      // Reset or create new record
      rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
      return true;
    }
    
    if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
      return false; // Rate limit exceeded
    }
    
    record.count++;
    return true;
  };

  // Define validation schema for listing optimizer
  const optimizeListingSchema = z.object({
    productName: z.string().min(1, "Product name is required").max(200, "Product name too long"),
    category: z.string().min(1, "Category is required").max(100, "Category too long"),
    features: z.string().min(1, "Features are required").max(5000, "Features description too long"), // Increased to handle longer product descriptions
    priceRange: z.string().max(50, "Price range too long").optional(),
    niche: z.string().max(100, "Niche too long").optional(),
  });

  // TikTok listing optimizer endpoint - has rate limiting to prevent abuse
  app.post("/api/optimize-listing", async (req, res) => {
    try {
      // Rate limiting check
      const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
      if (!checkRateLimit(clientIP)) {
        return res.status(429).json({
          message: "Too many requests. Please try again later.",
          error: "Rate limit exceeded",
          type: "rate_limit"
        });
      }

      // Validate request body
      const validationResult = optimizeListingSchema.safeParse(req.body);
      if (!validationResult.success) {
        const errorDetails = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
        return res.status(400).json({ 
          message: "Invalid input data",
          error: errorDetails,
          type: "validation_error"
        });
      }
      
      const { productName, category, features, priceRange, niche } = validationResult.data;

      // Track user activity
      await trackUserActivity(
        (req as any).trackingUserId,
        (req as any).trackingSessionId,
        "optimize_listing",
        {
          productName,
          category,
          hasFeatures: !!features,
          hasPriceRange: !!priceRange,
          hasNiche: !!niche
        }
      );

      // Smart category mapping to match user input to database categories
      const categoryMapping: { [key: string]: string[] } = {
        // Health & Wellness
        'health': ['Beauty & Personal Care', 'Food & Beverages'],
        'supplements': ['Beauty & Personal Care', 'Food & Beverages'],
        'vitamins': ['Beauty & Personal Care', 'Food & Beverages'],
        'wellness': ['Beauty & Personal Care', 'Food & Beverages'],
        'nutrition': ['Food & Beverages'],
        'fitness': ['Sports & Outdoor', 'Beauty & Personal Care'],
        
        // Electronics
        'electronics': ['Phones & Electronics', 'Computers & Office Equipment'],
        'tech': ['Phones & Electronics', 'Computers & Office Equipment'],
        'gadgets': ['Phones & Electronics'],
        'phones': ['Phones & Electronics'],
        'computers': ['Computers & Office Equipment'],
        
        // Fashion & Clothing
        'fashion': ['Womenswear & Underwear', 'Menswear & Underwear', 'Fashion Accessories'],
        'clothing': ['Womenswear & Underwear', 'Menswear & Underwear'],
        'apparel': ['Womenswear & Underwear', 'Menswear & Underwear'],
        'accessories': ['Fashion Accessories'],
        'shoes': ['Shoes'],
        'bags': ['Luggage & Bags'],
        
        // Beauty
        'beauty': ['Beauty & Personal Care'],
        'cosmetics': ['Beauty & Personal Care'],
        'skincare': ['Beauty & Personal Care'],
        'makeup': ['Beauty & Personal Care'],
        
        // Home & Living
        'home': ['Home Supplies', 'Furniture', 'Home Improvement'],
        'furniture': ['Furniture'],
        'kitchen': ['Kitchenware'],
        'appliances': ['Household Appliances'],
        
        // Sports & Outdoor
        'sports': ['Sports & Outdoor'],
        'outdoor': ['Sports & Outdoor'],
        'exercise': ['Sports & Outdoor'],
        'sports & outdoors': ['Sports & Outdoor'], // Map the dropdown option to correct category
        
        // Food & Beverages
        'food': ['Food & Beverages'],
        'drinks': ['Food & Beverages'],
        'beverages': ['Food & Beverages'],
        
        // Baby & Kids
        'baby': ['Baby & Maternity'],
        'kids': ["Kids' Fashion", 'Toys & Hobbies'],
        'children': ["Kids' Fashion", 'Toys & Hobbies'],
        'toys': ['Toys & Hobbies'],
        
        // Automotive
        'automotive': ['Automotive & Motorcycle'],
        'car': ['Automotive & Motorcycle'],
        'motorcycle': ['Automotive & Motorcycle']
      };

      // Find matching categories
      const userCategory = category.toLowerCase();
      let searchCategories: string[] = [];
      
      // First try exact match
      for (const [key, categories] of Object.entries(categoryMapping)) {
        if (userCategory.includes(key) || key.includes(userCategory)) {
          searchCategories.push(...categories);
        }
      }
      
      // If no matches found, try the original category
      if (searchCategories.length === 0) {
        searchCategories = [category];
      }
      
      // Remove duplicates
      searchCategories = Array.from(new Set(searchCategories));

      // PRIORITIZED KEYWORD RETRIEVAL
      // Step 1: Extract core phrases from product name and features
      const coreProductTerms: string[] = [];
      const productWords = productName.toLowerCase().split(/\s+/).filter(word => word.length > 2);
      const featureWords = features.toLowerCase().split(/\s+/).filter(word => word.length > 2);
      
      // Add individual product words
      coreProductTerms.push(...productWords);
      
      // Add product name as a phrase
      coreProductTerms.push(productName.toLowerCase());
      
      // Add important feature phrases (2-3 word combinations)
      const allWords = [...productWords, ...featureWords];
      for (let i = 0; i < allWords.length - 1; i++) {
        if (allWords[i].length > 2 && allWords[i + 1].length > 2) {
          coreProductTerms.push(`${allWords[i]} ${allWords[i + 1]}`);
        }
      }

      console.log(`[KEYWORD SEARCH] Core product terms extracted: ${coreProductTerms.join(', ')}`);

      // Step 2: Search for EXACT MATCHES across ALL periods and metrics (no category filter)
      let prioritizedKeywords: any[] = [];
      
      for (const term of coreProductTerms) {
        try {
          // Search without category filter to find ALL matching keywords
          const exactMatches = await storage.searchKeywords(term, "");
          prioritizedKeywords.push(...exactMatches);
          console.log(`[KEYWORD SEARCH] Found ${exactMatches.length} matches for "${term}"`);
        } catch (error) {
          console.log(`[KEYWORD SEARCH] Error searching for "${term}":`, error);
        }
      }

      // FALLBACK LOGIC: If no direct matches found, widen the search
      if (prioritizedKeywords.length === 0) {
        console.log(`[KEYWORD SEARCH] No direct matches found, applying fallback logic...`);
        
        // Try broader searches with partial word matches
        const broadSearchTerms = productWords.filter(word => word.length > 3); // Only longer words
        for (const word of broadSearchTerms) {
          try {
            const broadMatches = await storage.searchKeywords(word, "");
            prioritizedKeywords.push(...broadMatches);
            console.log(`[KEYWORD SEARCH FALLBACK] Found ${broadMatches.length} matches for broad term "${word}"`);
          } catch (error) {
            console.log(`[KEYWORD SEARCH FALLBACK] Error searching for "${word}":`, error);
          }
        }
      }

      // Step 3: Search for keywords using category filter (existing logic)
      let categoryKeywords: any[] = [];
      for (const searchCategory of searchCategories) {
        const categoryResults = await storage.searchKeywords("", searchCategory);
        categoryKeywords.push(...categoryResults);
      }
      
      // Step 4: Merge and prioritize - exact matches first, then category matches
      const allKeywords = [...prioritizedKeywords, ...categoryKeywords];
      
      // Remove duplicates and prioritize exact matches
      const seenKeywords = new Set<string>();
      const finalKeywords = allKeywords.filter(keyword => {
        if (seenKeywords.has(keyword.keyword)) {
          return false;
        }
        seenKeywords.add(keyword.keyword);
        return true;
      });

      // Sort by relevance: prioritized keywords first (those containing core terms), then by search volume
      finalKeywords.sort((a, b) => {
        const aContainsCoreTerms = coreProductTerms.some(term => 
          a.keyword.toLowerCase().includes(term) || term.includes(a.keyword.toLowerCase())
        );
        const bContainsCoreTerms = coreProductTerms.some(term => 
          b.keyword.toLowerCase().includes(term) || term.includes(b.keyword.toLowerCase())
        );
        
        if (aContainsCoreTerms && !bContainsCoreTerms) return -1;
        if (!aContainsCoreTerms && bContainsCoreTerms) return 1;
        
        // If both or neither contain core terms, sort by search volume
        return (b.searchVolume || 0) - (a.searchVolume || 0);
      });
      
      // Provide more keywords for better AI selection - TikTok algorithm supports 8-12 keywords when naturally integrated
      const keywordPool = finalKeywords.slice(0, 30); // Get top 30 keywords with full data
      const keywordSuggestions = keywordPool.map((k: any) => k.keyword);
      
      // Categorize keywords for strategic AI usage (TikTok Shop algorithm compliance)
      const primaryKeywords = keywordPool.filter(k => 
        coreProductTerms.some(term => 
          k.keyword.toLowerCase().includes(term) || term.includes(k.keyword.toLowerCase())
        )
      ).slice(0, 8); // Top 8 direct matches
      
      const supportingKeywords = keywordPool.filter(k => 
        !coreProductTerms.some(term => 
          k.keyword.toLowerCase().includes(term) || term.includes(k.keyword.toLowerCase())
        ) && (k.searchVolume || 0) > 10000 // High volume supporting keywords
      ).slice(0, 12); // Top 12 high-volume supporting
      
      const longTailKeywords = keywordPool.filter(k => 
        !coreProductTerms.some(term => 
          k.keyword.toLowerCase().includes(term) || term.includes(k.keyword.toLowerCase())
        ) && (k.searchVolume || 0) <= 10000 && k.keyword.split(' ').length >= 2 // Multi-word, lower competition
      ).slice(0, 10); // Top 10 long-tail
      
      console.log(`[KEYWORD CATEGORIZATION] Primary (${primaryKeywords.length}): ${primaryKeywords.map(k => k.keyword).join(', ')}`);
      console.log(`[KEYWORD CATEGORIZATION] Supporting (${supportingKeywords.length}): ${supportingKeywords.map(k => k.keyword).join(', ')}`);
      console.log(`[KEYWORD CATEGORIZATION] Long-tail (${longTailKeywords.length}): ${longTailKeywords.map(k => k.keyword).join(', ')}`);

      // Prepare OpenAI prompt with FRONT-LOADED keyword requirements
      const prompt = `🚨 CRITICAL REQUIREMENT: You MUST use exactly 10-12 keywords in your keywordAnalysis array. This is MANDATORY for TikTok Shop compliance.

❌ FAILURE CONDITION: If you provide fewer than 10 keywords in keywordAnalysis, the optimization will be rejected.

✅ SUCCESS CONDITION: Provide 10-12 keywords in keywordAnalysis with strategic distribution across title and description.

As a TikTok Shop listing optimization expert, create an optimized product title and description.

Product Information:
- Product Name: ${productName}
- Category: ${category}
- Key Features: ${features}
- Price Range: ${priceRange || 'Not specified'}
- Niche: ${niche || 'General'}

Available Keywords from Database - STRATEGICALLY CATEGORIZED:

🎯 **PRIMARY KEYWORDS** (Use 2-3 of these - direct product matches):
${primaryKeywords.map(k => `${k.keyword} (${k.searchVolume} vol)`).join(', ')}

📈 **SUPPORTING KEYWORDS** (Use 3-4 of these - high-volume discovery):  
${supportingKeywords.map(k => `${k.keyword} (${k.searchVolume} vol)`).join(', ')}

🔍 **LONG-TAIL KEYWORDS** (Use 3-5 of these - natural integration):
${longTailKeywords.map(k => `${k.keyword} (${k.searchVolume || 0} vol)`).join(', ')}

TikTok Shop Best Practices:
- Title: 40-80 characters, benefit-focused, avoid technical jargon
- Description: Mobile-friendly bullet points, highlight unique selling points
- Include problem-solving language rather than just features
- Use conversational tone that resonates with TikTok audience

CRITICAL KEYWORD STRATEGY - TikTok Algorithm Compliant:
According to TikTok Shop algorithm guidelines, optimal keyword usage is 8-12 keywords naturally integrated across title and description.

✅ **TIER 1: PRIMARY KEYWORDS (2-3 keywords)** - The first keywords in the list are EXACT MATCHES to your product. These are your CORE targeting keywords that define what customers search for.

✅ **TIER 2: HIGH-VOLUME SUPPORTING KEYWORDS (3-4 keywords)** - Use these proven high-performers from TikTok Shop data to maximize discoverability and reach broader audiences.

✅ **TIER 3: LONG-TAIL KEYWORDS (3-5 keywords)** - Lower competition, higher relevance keywords that help with specific customer intent and natural language integration.

Strategic Integration Guidelines:
- **Title**: 2-3 primary keywords (within 40-80 characters)
- **Description**: 6-9 additional keywords (mix of supporting and long-tail)
- **Natural Flow**: Keywords must read authentically, not stuffed
- **User Intent**: Match how real TikTok users search and speak

**MANDATORY COMPLIANCE TARGET: You MUST use 8-12 keywords total. This is REQUIRED for TikTok Shop algorithm optimization:**

🎯 **REQUIRED BREAKDOWN:**
- 2-3 PRIMARY keywords (from 🎯 section above) - MUST USE AT LEAST 2
- 3-4 SUPPORTING keywords (from 📈 section above) - MUST USE AT LEAST 3  
- 3-5 LONG-TAIL keywords (from 🔍 section above) - MUST USE AT LEAST 3

**MINIMUM ACCEPTABLE: 8 keywords total (anything less than 8 keywords is FAILED optimization)**
**OPTIMAL TARGET: 10-12 keywords for maximum TikTok Shop performance**

❌ **REJECTION CRITERIA**: If you use fewer than 8 keywords total, the optimization is considered FAILED and non-compliant with TikTok Shop algorithm requirements.

**EXAMPLE FOR WATER BOTTLE PRODUCT** - You should aim for this keyword count:
{
  "keywordAnalysis": [
    {"keyword": "knock bottles", "usedIn": "title", "reason": "Primary keyword - direct match"},
    {"keyword": "stainless steel", "usedIn": "title", "reason": "Primary keyword - material match"},
    {"keyword": "water bottle", "usedIn": "both", "reason": "Primary keyword - product match"},
    {"keyword": "eco-friendly", "usedIn": "description", "reason": "Supporting keyword - sustainability appeal"},
    {"keyword": "insulated", "usedIn": "description", "reason": "Supporting keyword - key feature"},
    {"keyword": "leak-proof", "usedIn": "description", "reason": "Supporting keyword - benefit"},
    {"keyword": "cold drinks", "usedIn": "description", "reason": "Supporting keyword - usage"},
    {"keyword": "outdoor adventures", "usedIn": "description", "reason": "Long-tail - lifestyle connection"},
    {"keyword": "sports gear", "usedIn": "description", "reason": "Long-tail - category connection"},
    {"keyword": "hydration solution", "usedIn": "description", "reason": "Long-tail - problem solving"},
    {"keyword": "durable bottle", "usedIn": "description", "reason": "Long-tail - quality emphasis"},
    {"keyword": "travel companion", "usedIn": "description", "reason": "Long-tail - usage context"}
  ]
}
**↑ This shows 12 keywords total (3 primary + 4 supporting + 5 long-tail) - THIS IS YOUR TARGET**

IMPORTANT: Provide detailed analysis for EVERY keyword you use, explaining the strategic reasoning behind each choice.

**TRUST-BUILDING REQUIREMENT**: Users need to see the specific value you provided. You MUST explain:
1. What specific changes you made to improve the title and WHY those changes help
2. How TikTok keywords from our database enhanced the title's searchability
3. What specific changes you made to improve the description and WHY those changes help  
4. How TikTok keywords from our database enhanced the description's discoverability

⚠️ **CRITICAL VERIFICATION REQUIREMENT**: Only list keywords in keywordAnalysis that you ACTUALLY used in the title or description text. We automatically verify every keyword claim.

✅ **CORRECT EXAMPLE**:
- If your title is: "Premium Water Bottle with Leak-Proof Design" 
- Then keywordAnalysis can include: {"keyword": "water bottle", "usedIn": "title", "reason": "..."}
- Then keywordAnalysis can include: {"keyword": "leak-proof", "usedIn": "title", "reason": "..."}

❌ **WRONG EXAMPLE**:  
- If your title is: "Premium Water Bottle with Leak-Proof Design"
- DON'T include: {"keyword": "stainless steel", "usedIn": "title", "reason": "..."} ← This isn't in the title!

📋 **VERIFICATION PROCESS**: We check each keyword you claim against the actual title/description text. False claims are automatically removed.

Generate optimized content in JSON format:
{
  "title": "optimized product title",
  "description": "optimized product description with bullet points",
  "titleImprovement": {
    "changes": "Specific changes made to the title compared to the original",
    "benefits": "How these changes improve the title (searchability, appeal, etc.)",
    "keywordEnhancement": "How TikTok keywords from the database enhanced the title"
  },
  "descriptionImprovement": {
    "changes": "Specific changes made to the description compared to the original", 
    "benefits": "How these changes improve the description (engagement, conversion, etc.)",
    "keywordEnhancement": "How TikTok keywords from the database enhanced the description"
  },
  "keywordAnalysis": [
    {
      "keyword": "exact keyword that appears in your title/description",
      "usedIn": "title|description|both",
      "reason": "detailed explanation of why this keyword was chosen and how it improves optimization"
    }
  ],
  "suggestedKeywords": ["keyword1", "keyword2", "keyword3"],
  "tiktokTips": ["tip1", "tip2", "tip3"]
}`;

      // Call OpenAI API
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error("OpenAI API key not configured");
      }
      
      // Debug: Check if API key is present (log only the first 10 characters for security)
      console.log(`Using OpenAI API key: ${apiKey.substring(0, 10)}...`);
      console.log(`API key length: ${apiKey.length}`);
      
      const openai = new (await import('openai')).default({ apiKey });
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      });

      const content = response.choices[0].message.content;
      if (!content) {
        throw new Error("No content received from OpenAI");
      }
      
      const optimization = JSON.parse(content);

      // Log the optimization response for debugging
      console.log(`[OPTIMIZATION] Received response:`, JSON.stringify(optimization, null, 2));

      // Get title and description for keyword verification with defensive coding
      const title = (typeof optimization.title === 'string' ? optimization.title : String(optimization.title || '')).toLowerCase();
      const description = (typeof optimization.description === 'string' ? optimization.description : String(optimization.description || '')).toLowerCase();
      
      console.log(`[OPTIMIZATION] Processed title: "${title}"`);
      console.log(`[OPTIMIZATION] Processed description: "${description}"`);

      // Enhanced keyword analysis - cross-reference used keywords with database metrics
      // BUT FIRST: Verify the AI's claims about which keywords it actually used
      const usedKeywords = optimization.keywordAnalysis || [];
      
      console.log(`[KEYWORD VERIFICATION] AI claimed to use ${usedKeywords.length} keywords:`, usedKeywords.map((k: any) => k.keyword).join(', '));
      
      const verifiedKeywords = usedKeywords.filter((analysis: any) => {
        const keywordLower = analysis.keyword.toLowerCase();
        const titleWords = title.split(/\s+/);
        const descWords = description.split(/\s+/);
        const keywordWords = keywordLower.split(/\s+/);
        
        let actuallyInTitle = false;
        let actuallyInDescription = false;
        
        // For single word keywords, check exact word match
        if (keywordWords.length === 1) {
          actuallyInTitle = titleWords.includes(keywordLower);
          actuallyInDescription = descWords.includes(keywordLower);
        } else {
          // For multi-word keywords, check exact phrase match
          actuallyInTitle = title.includes(keywordLower);
          actuallyInDescription = description.includes(keywordLower);
        }
        
        // Update the usedIn field based on actual content
        let actualUsedIn = [];
        if (actuallyInTitle) actualUsedIn.push('title');
        if (actuallyInDescription) actualUsedIn.push('description');
        
        // STRICT VERIFICATION - Only keep keywords that are actually used
        if (actualUsedIn.length > 0) {
          analysis.usedIn = actualUsedIn.join(', ');
          return true; // Keep this keyword analysis
        } else {
          console.log(`[KEYWORD VERIFICATION] AI claimed "${analysis.keyword}" was used but it's not actually in the content. Removing from analysis.`);
          return false; // Remove this false claim
        }
      });
      
      const enhancedKeywordAnalysis = verifiedKeywords.map((analysis: any) => {
        // Find matching keyword data from database
        const keywordData = finalKeywords.find((k: any) => 
          k.keyword.toLowerCase() === analysis.keyword.toLowerCase()
        );
        
        return {
          ...analysis,
          metrics: keywordData ? {
            searchVolume: keywordData.searchVolume,
            productClickScore: parseFloat(keywordData.productClickScore || "0"),
            skuSalesScore: parseFloat(keywordData.skuSalesScore || "0"),
            availableProducts: keywordData.availableProducts,
            averagePrice: parseFloat(keywordData.averagePrice || "0"),
            ctrScore: parseFloat(keywordData.ctrScore || "0"),
            ctorScore: parseFloat(keywordData.ctorScore || "0"),
            isHpk: keywordData.isHpk,
            isRk: keywordData.isRk,
            rank: keywordData.rank,
            category: keywordData.category,
            subCategory1: keywordData.subCategory1,
            subCategory2: keywordData.subCategory2
          } : null
        };
      });

      // Also identify any database keywords that appear in title/description but weren't in the analysis
      const analyzedKeywords = usedKeywords.map((k: any) => k.keyword.toLowerCase());
      
      const additionalUsedKeywords = keywordSuggestions
        .filter(keyword => {
          const keywordLower = keyword.toLowerCase();
          if (analyzedKeywords.includes(keywordLower)) return false;
          
          // Check for whole word/phrase matches instead of substring matches
          const titleWords = title.toLowerCase().split(/\s+/);
          const descWords = description.toLowerCase().split(/\s+/);
          const keywordWords = keywordLower.split(/\s+/);
          
          // For single word keywords, check exact word match
          if (keywordWords.length === 1) {
            return titleWords.includes(keywordLower) || descWords.includes(keywordLower);
          }
          
          // For multi-word keywords, check if the exact phrase appears
          return title.includes(keywordLower) || description.includes(keywordLower);
        })
        .map(keyword => {
          const keywordData = finalKeywords.find((k: any) => 
            k.keyword.toLowerCase() === keyword.toLowerCase()
          );
          
          const keywordLower = keyword.toLowerCase();
          const titleWords = title.toLowerCase().split(/\s+/);
          const descWords = description.toLowerCase().split(/\s+/);
          const keywordWords = keywordLower.split(/\s+/);
          
          let usedIn = [];
          
          // Check title usage
          if (keywordWords.length === 1) {
            if (titleWords.includes(keywordLower)) usedIn.push('title');
          } else {
            if (title.includes(keywordLower)) usedIn.push('title');
          }
          
          // Check description usage  
          if (keywordWords.length === 1) {
            if (descWords.includes(keywordLower)) usedIn.push('description');
          } else {
            if (description.includes(keywordLower)) usedIn.push('description');
          }
          
          return {
            keyword,
            usedIn: usedIn.join(', '),
            reason: 'Identified in content but not explicitly analyzed',
            metrics: keywordData ? {
              searchVolume: keywordData.searchVolume,
              productClickScore: keywordData.productClickScore,
              averagePrice: keywordData.averagePrice
            } : null
          };
        });

      // Combine analyzed and additional keywords
      optimization.keywordAnalysis = [...enhancedKeywordAnalysis, ...additionalUsedKeywords];
      
      // Keep original database keywords for reference, but limit to those not used
      const unusedKeywords = keywordSuggestions.filter(keyword => 
        !optimization.keywordAnalysis.some((analysis: any) => 
          analysis.keyword.toLowerCase() === keyword.toLowerCase()
        )
      );
      
      optimization.databaseKeywords = unusedKeywords;
      optimization.keywordData = finalKeywords.slice(0, 5).map((k: any) => ({
        keyword: k.keyword,
        searchVolume: k.searchVolume,
        productClickScore: k.productClickScore,
        averagePrice: k.averagePrice
      }));

      res.json({
        success: true,
        optimization
      });

    } catch (error: any) {
      console.error("Error optimizing listing:", error);
      
      // Handle OpenAI SDK v4 APIError properly
      if (error.status === 429 || error.code === 'rate_limit_exceeded') {
        res.status(429).json({ 
          message: "AI service is currently at capacity. Please try again in a few minutes.", 
          error: "Rate limit exceeded",
          type: "rate_limit"
        });
      } else if (error.status === 402 || error.code === 'insufficient_quota' || error.message?.includes('quota')) {
        res.status(503).json({ 
          message: "AI service is temporarily unavailable due to quota limits. Please try again later.", 
          error: "Service quota exceeded",
          type: "quota_exceeded"
        });
      } else if (error.status === 401 || error.code === 'invalid_api_key') {
        res.status(503).json({ 
          message: "AI service configuration issue. Please contact support.", 
          error: "Authentication failed",
          type: "config_error"
        });
      } else if (error.status >= 500) {
        res.status(503).json({ 
          message: "AI service is temporarily unavailable. Please try again later.", 
          error: "Service unavailable",
          type: "service_error"
        });
      } else {
        // Generic error handling
        res.status(500).json({ 
          message: "Failed to optimize listing. Please try again.", 
          error: error.message || "Unknown error",
          type: "generic_error"
        });
      }
    }
  });

  // Helper function to classify user intent for chat optimization
  function classifyUserIntent(userMessage: string): string {
    const message = userMessage.toLowerCase().trim();
    
    // Remove keyword patterns
    if (message.includes('remove') && (message.includes('keyword') || message.includes('word'))) {
      return 'remove_keyword';
    }
    
    // Add keyword patterns
    if (message.includes('add') && (message.includes('keyword') || message.includes('word'))) {
      return 'add_keyword';
    }
    
    // Shorten/lengthen patterns
    if (message.includes('shorter') || message.includes('shorten') || message.includes('reduce length')) {
      return 'shorten_content';
    }
    if (message.includes('longer') || message.includes('lengthen') || message.includes('expand')) {
      return 'lengthen_content';
    }
    
    // Tone/style patterns
    if (message.includes('tone') || message.includes('style') || message.includes('casual') || message.includes('formal')) {
      return 'change_tone';
    }
    
    // Explanation patterns
    if (message.includes('why') || message.includes('explain') || message.includes('reason')) {
      return 'explain';
    }
    
    // Price/benefit focus
    if (message.includes('price') || message.includes('cost') || message.includes('benefit') || message.includes('feature')) {
      return 'adjust_focus';
    }
    
    // Default to general modification
    return 'modify_content';
  }

  // Interactive chat optimization endpoint
  app.post("/api/optimize-chat", async (req, res) => {
    try {
      // Rate limiting check
      const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
      if (!checkRateLimit(clientIP)) {
        return res.status(429).json({
          message: "Too many requests. Please try again later.",
          error: "Rate limit exceeded",
          type: "rate_limit"
        });
      }

      // Validate request body
      const validationResult = chatRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        const errorDetails = fromZodError(validationResult.error).toString();
        return res.status(400).json({ 
          message: "Invalid chat request",
          error: errorDetails,
          type: "validation_error"
        });
      }
      
      const { optimizationId, userMessage, currentState, intent } = validationResult.data;

      // Track user activity
      await trackUserActivity(
        (req as any).trackingUserId,
        (req as any).trackingSessionId,
        "chat_optimization",
        {
          optimizationId,
          intent: intent || classifyUserIntent(userMessage),
          messageLength: userMessage.length
        }
      );

      // Classify intent if not provided
      const detectedIntent = intent || classifyUserIntent(userMessage);
      console.log(`[CHAT] User message: "${userMessage}"`);
      console.log(`[CHAT] Detected intent: ${detectedIntent}`);

      // Handle explanation requests without calling OpenAI
      if (detectedIntent === 'explain') {
        const keywordToExplain = userMessage.match(/why.*?(\w+(?:\s+\w+)*)/i);
        if (keywordToExplain) {
          const keyword = keywordToExplain[1].toLowerCase();
          const keywordAnalysis = currentState.keywordAnalysis.find(k => 
            k.keyword.toLowerCase().includes(keyword) || keyword.includes(k.keyword.toLowerCase())
          );
          
          if (keywordAnalysis && keywordAnalysis.metrics) {
            const response = `I selected "${keywordAnalysis.keyword}" because:

• **High Search Volume**: ${keywordAnalysis.metrics.searchVolume?.toLocaleString() || 'N/A'} monthly searches on TikTok Shop
• **Strong Performance**: ${keywordAnalysis.metrics.ctrScore ? (keywordAnalysis.metrics.ctrScore * 100).toFixed(1) + '% CTR score' : 'Good engagement metrics'}
• **Strategic Reason**: ${keywordAnalysis.reason}
• **Category Relevance**: ${keywordAnalysis.metrics.category || 'Targeted category match'}
${keywordAnalysis.metrics.isHpk ? '• **High-Potential Keyword**: This is a trending keyword with growing search volume' : ''}
${keywordAnalysis.metrics.isRk ? '• **Rising Keyword**: This keyword is gaining popularity and has lower competition' : ''}

This keyword helps your listing get discovered by customers actively searching for ${keywordAnalysis.usedIn === 'both' ? 'products like yours' : 'this specific feature'}.`;

            return res.json({
              message: response,
              noChange: true
            });
          }
        }
        
        // Fallback explanation
        return res.json({
          message: "I chose keywords based on TikTok Shop search volume data, relevance to your product, and strategic keyword placement to maximize discoverability while maintaining natural readability.",
          noChange: true
        });
      }

      // For content modifications, call OpenAI
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error("OpenAI API key not configured");
      }

      // Build specialized prompt based on intent
      let promptInstruction = '';
      switch (detectedIntent) {
        case 'remove_keyword':
          promptInstruction = `The user wants to remove a specific keyword. Identify which keyword they want removed from "${userMessage}" and update the title and/or description to remove that keyword while maintaining natural flow. Ensure the removed keyword is no longer in the keywordAnalysis array.`;
          break;
        case 'add_keyword':
          promptInstruction = `The user wants to add a specific keyword. Extract the keyword they want added from "${userMessage}" and naturally incorporate it into the title or description. Add it to the keywordAnalysis array if successfully included.`;
          break;
        case 'shorten_content':
          promptInstruction = `The user wants shorter content. Make the title and/or description more concise while preserving key keywords and benefits.`;
          break;
        case 'lengthen_content':
          promptInstruction = `The user wants more detailed content. Expand the title and/or description with additional benefits and features while maintaining keyword usage.`;
          break;
        case 'change_tone':
          promptInstruction = `The user wants to adjust the tone or style. Modify the language to match their requested tone while keeping the same keywords and core message.`;
          break;
        case 'adjust_focus':
          promptInstruction = `The user wants to emphasize different aspects (price, benefits, features). Adjust the content focus while maintaining keyword optimization.`;
          break;
        default:
          promptInstruction = `Apply the user's requested change: "${userMessage}". Make minimal modifications while preserving keyword optimization.`;
      }

      const chatPrompt = `You are helping optimize a TikTok Shop listing. The user has an existing optimized listing and wants to make a specific change.

CURRENT LISTING:
Title: ${currentState.title}
Description: ${currentState.description}

USER REQUEST: ${userMessage}

INSTRUCTION: ${promptInstruction}

CRITICAL VERIFICATION REQUIREMENT: Only list keywords in keywordAnalysis that you ACTUALLY use in the updated title or description text. We automatically verify every keyword claim.

MINIMAL CHANGE POLICY: Make only the specific changes requested. Don't rewrite everything unless explicitly asked.

Return JSON with this structure:
{
  "title": "updated title (only if changed)",
  "description": "updated description (only if changed)", 
  "keywordAnalysis": [
    {
      "keyword": "exact keyword that appears in your updated content",
      "usedIn": "title|description|both",
      "reason": "why this keyword was kept or added"
    }
  ],
  "changesSummary": "brief description of what changed"
}

If no changes are needed, return: {"noChange": true, "message": "explanation why no changes were made"}`;

      console.log(`[CHAT] Sending prompt to OpenAI for intent: ${detectedIntent}`);

      const openai = new (await import('openai')).default({ apiKey });
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: chatPrompt }],
        response_format: { type: "json_object" },
      });

      const content = response.choices[0].message.content;
      if (!content) {
        throw new Error("No content received from OpenAI");
      }
      
      const aiResponse = JSON.parse(content);
      console.log(`[CHAT] AI response:`, JSON.stringify(aiResponse, null, 2));

      // If AI says no change needed
      if (aiResponse.noChange) {
        return res.json({
          message: aiResponse.message || "No changes were needed based on your request.",
          noChange: true
        });
      }

      // Verify keywords in updated content (same logic as main optimization)
      const updatedTitle = (aiResponse.title || currentState.title).toLowerCase();
      const updatedDescription = (aiResponse.description || currentState.description).toLowerCase();
      
      const verifiedKeywords = (aiResponse.keywordAnalysis || []).filter((analysis: any) => {
        const keywordLower = analysis.keyword.toLowerCase();
        const titleWords = updatedTitle.split(/\s+/);
        const descWords = updatedDescription.split(/\s+/);
        const keywordWords = keywordLower.split(/\s+/);
        
        let actuallyInTitle = false;
        let actuallyInDescription = false;
        
        // For single word keywords, check exact word match
        if (keywordWords.length === 1) {
          actuallyInTitle = titleWords.includes(keywordLower);
          actuallyInDescription = descWords.includes(keywordLower);
        } else {
          // For multi-word keywords, check exact phrase match
          actuallyInTitle = updatedTitle.includes(keywordLower);
          actuallyInDescription = updatedDescription.includes(keywordLower);
        }
        
        // Update the usedIn field based on actual content
        let actualUsedIn = [];
        if (actuallyInTitle) actualUsedIn.push('title');
        if (actuallyInDescription) actualUsedIn.push('description');
        
        if (actualUsedIn.length > 0) {
          analysis.usedIn = actualUsedIn.join(', ');
          return true;
        } else {
          console.log(`[CHAT VERIFICATION] AI claimed "${analysis.keyword}" was used but it's not in updated content. Removing.`);
          return false;
        }
      });

      // Create updated state
      const updatedState = {
        ...currentState,
        title: aiResponse.title || currentState.title,
        description: aiResponse.description || currentState.description,
        keywordAnalysis: verifiedKeywords
      };

      res.json({
        updatedState,
        message: `I've updated your listing based on your request. ${aiResponse.changesSummary || 'Changes applied successfully.'}`,
        changesSummary: aiResponse.changesSummary
      });

    } catch (error: any) {
      console.error("Error in chat optimization:", error);
      
      // Handle OpenAI errors
      if (error.status === 429 || error.code === 'rate_limit_exceeded') {
        res.status(429).json({ 
          message: "AI service is currently at capacity. Please try again in a few minutes.", 
          error: "Rate limit exceeded",
          type: "rate_limit"
        });
      } else if (error.status === 402 || error.code === 'insufficient_quota') {
        res.status(503).json({ 
          message: "AI service is temporarily unavailable. Please try again later.", 
          error: "Service quota exceeded",
          type: "quota_exceeded"
        });
      } else {
        res.status(500).json({ 
          message: "Failed to process your request. Please try again.", 
          error: error.message || "Unknown error",
          type: "generic_error"
        });
      }
    }
  });

  // ==========================================
  // ADS MANAGEMENT API ROUTES
  // ==========================================

  // Ad Clients Management
  app.get("/api/ads/clients", isAdmin, async (req, res) => {
    try {
      const clients = await storage.getAdClients();
      res.json(clients);
    } catch (error: any) {
      console.error("Error fetching ad clients:", error);
      res.status(500).json({ message: "Failed to fetch clients", error: error.message });
    }
  });

  app.get("/api/ads/clients/:id", isAdmin, async (req, res) => {
    try {
      const client = await storage.getAdClient(req.params.id);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      res.json(client);
    } catch (error: any) {
      console.error("Error fetching ad client:", error);
      res.status(500).json({ message: "Failed to fetch client", error: error.message });
    }
  });

  app.post("/api/ads/clients", isAdmin, async (req, res) => {
    try {
      const validationResult = insertAdClientSchema.safeParse(req.body);
      if (!validationResult.success) {
        const errorDetails = fromZodError(validationResult.error);
        return res.status(400).json({ message: "Invalid client data", error: errorDetails });
      }

      const newClient = await storage.createAdClient(validationResult.data);
      res.status(201).json(newClient);
    } catch (error: any) {
      console.error("Error creating ad client:", error);
      res.status(500).json({ message: "Failed to create client", error: error.message });
    }
  });

  app.put("/api/ads/clients/:id", isAdmin, async (req, res) => {
    try {
      const validationResult = insertAdClientSchema.partial().safeParse(req.body);
      if (!validationResult.success) {
        const errorDetails = fromZodError(validationResult.error);
        return res.status(400).json({ message: "Invalid client data", error: errorDetails });
      }

      const updatedClient = await storage.updateAdClient(req.params.id, validationResult.data);
      res.json(updatedClient);
    } catch (error: any) {
      console.error("Error updating ad client:", error);
      res.status(500).json({ message: "Failed to update client", error: error.message });
    }
  });

  app.delete("/api/ads/clients/:id", isAdmin, async (req, res) => {
    try {
      await storage.deleteAdClient(req.params.id);
      res.json({ message: "Client deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting ad client:", error);
      res.status(500).json({ message: "Failed to delete client", error: error.message });
    }
  });

  // Ad Campaigns Management
  app.get("/api/ads/campaigns", isAdmin, async (req, res) => {
    try {
      const { clientId, limit } = req.query;
      const campaigns = await storage.getAdCampaigns(
        clientId as string || undefined,
        limit ? parseInt(limit as string) : undefined
      );
      res.json(campaigns);
    } catch (error: any) {
      console.error("Error fetching ad campaigns:", error);
      res.status(500).json({ message: "Failed to fetch campaigns", error: error.message });
    }
  });

  app.get("/api/ads/campaigns/client/:clientId", isAdmin, async (req, res) => {
    try {
      const campaigns = await storage.getAdCampaignsByClient(req.params.clientId);
      res.json(campaigns);
    } catch (error: any) {
      console.error("Error fetching campaigns by client:", error);
      res.status(500).json({ message: "Failed to fetch campaigns", error: error.message });
    }
  });

  // CSV Upload for Ad Campaigns
  app.post("/api/ads/campaigns/upload/:clientId", isAdmin, upload.single("csvFile"), async (req, res) => {
    try {
      const { clientId } = req.params;
      
      // Verify client exists
      const client = await storage.getAdClient(clientId);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No CSV file uploaded" });
      }

      const csvContent = req.file.buffer.toString('utf8');
      
      // Parse CSV
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        delimiter: ','
      });

      if (!Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ message: "CSV file is empty or invalid" });
      }

      console.log("Sample CSV record:", records[0]);

      // Process CSV records and create campaigns
      const processedCampaigns = [];
      const errors = [];
      const uploadPeriod = new Date().toISOString().slice(0, 7); // YYYY-MM format

      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        
        try {
          // Map CSV fields to campaign data - adjust field names as needed
          const campaignData: any = {
            clientId,
            campaignName: record['Campaign Name'] || record['campaign_name'] || record['Campaign'] || `Campaign ${i+1}`,
            adGroupName: record['Ad Group Name'] || record['ad_group_name'] || record['Ad Group'],
            adName: record['Ad Name'] || record['ad_name'] || record['Ad'],
            impressions: parseInt(record['Impressions'] || record['impressions'] || '0'),
            clicks: parseInt(record['Clicks'] || record['clicks'] || '0'),
            spend: parseFloat(record['Spend'] || record['spend'] || record['Cost'] || '0'),
            orders: parseInt(record['Orders'] || record['orders'] || record['Conversions'] || '0'),
            gmv: parseFloat(record['GMV'] || record['gmv'] || record['Revenue'] || '0'),
            roas: parseFloat(record['ROAS'] || record['roas'] || '0'),
            ctr: parseFloat(record['CTR'] || record['ctr'] || '0'),
            cpc: parseFloat(record['CPC'] || record['cpc'] || '0'),
            cpm: parseFloat(record['CPM'] || record['cpm'] || '0'),
            conversionRate: parseFloat(record['Conversion Rate'] || record['conversion_rate'] || '0'),
            reportDate: new Date(record['Date'] || record['date'] || new Date()),
            uploadPeriod,
            rawData: record // Store full CSV row for debugging
          };

          // Validate campaign data
          const validationResult = insertAdCampaignSchema.safeParse(campaignData);
          if (!validationResult.success) {
            errors.push({
              row: i + 1,
              error: `Validation failed: ${fromZodError(validationResult.error)}`
            });
            continue;
          }

          const createdCampaign = await storage.createAdCampaign(validationResult.data);
          processedCampaigns.push(createdCampaign);

        } catch (error: any) {
          errors.push({
            row: i + 1,
            error: error.message
          });
        }
      }

      // Track user activity
      await trackUserActivity(
        (req as any).trackingUserId,
        (req as any).trackingSessionId,
        "csv_upload_ads",
        {
          clientId,
          rowsProcessed: records.length,
          successfulImports: processedCampaigns.length,
          errors: errors.length
        }
      );

      res.json({
        message: `Successfully processed ${processedCampaigns.length} campaigns from CSV`,
        imported: processedCampaigns.length,
        total: records.length,
        errors: errors.length > 0 ? errors : undefined
      });

    } catch (error: any) {
      console.error("Error processing CSV upload:", error);
      res.status(500).json({ message: "Failed to process CSV upload", error: error.message });
    }
  });

  // Optimization Recommendations
  app.get("/api/ads/recommendations", isAdmin, async (req, res) => {
    try {
      const { clientId, status } = req.query;
      const recommendations = await storage.getOptimizationRecommendations(
        clientId as string || undefined,
        status as string || undefined
      );
      res.json(recommendations);
    } catch (error: any) {
      console.error("Error fetching recommendations:", error);
      res.status(500).json({ message: "Failed to fetch recommendations", error: error.message });
    }
  });

  app.post("/api/ads/recommendations", isAdmin, async (req, res) => {
    try {
      const validationResult = insertOptimizationRecommendationSchema.safeParse(req.body);
      if (!validationResult.success) {
        const errorDetails = fromZodError(validationResult.error);
        return res.status(400).json({ message: "Invalid recommendation data", error: errorDetails });
      }

      const newRecommendation = await storage.createOptimizationRecommendation(validationResult.data);
      res.status(201).json(newRecommendation);
    } catch (error: any) {
      console.error("Error creating recommendation:", error);
      res.status(500).json({ message: "Failed to create recommendation", error: error.message });
    }
  });

  app.put("/api/ads/recommendations/:id/status", isAdmin, async (req, res) => {
    try {
      const { status, approvedAt, appliedAt } = req.body;
      
      if (!['pending', 'approved', 'rejected', 'applied'].includes(status)) {
        return res.status(400).json({ message: "Invalid status value" });
      }

      const updatedRecommendation = await storage.updateOptimizationRecommendationStatus(
        req.params.id,
        status,
        approvedAt ? new Date(approvedAt) : undefined,
        appliedAt ? new Date(appliedAt) : undefined
      );

      res.json(updatedRecommendation);
    } catch (error: any) {
      console.error("Error updating recommendation status:", error);
      res.status(500).json({ message: "Failed to update recommendation", error: error.message });
    }
  });

  // AI Optimization Engine - Generate Recommendations
  app.post("/api/ads/optimize/:clientId", isAdmin, async (req, res) => {
    try {
      const { clientId } = req.params;
      
      // Verify client exists
      const client = await storage.getAdClient(clientId);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }

      // Get recent campaign data for analysis
      const campaigns = await storage.getAdCampaignsByClient(clientId);
      
      if (campaigns.length === 0) {
        return res.status(400).json({ message: "No campaign data found for analysis" });
      }

      // Enhanced AI optimization logic with training materials context
      const recommendations = [];
      
      // Get relevant training materials for AI-enhanced recommendations
      const trainingMaterials = await storage.getTrainingMaterials();
      const campaignOptimizationMaterials = trainingMaterials.filter(m => 
        m.category === 'campaign_optimization' || 
        m.category === 'bidding_strategies' || 
        m.documentType === 'best_practices'
      );

      for (const campaign of campaigns) {
        // AI-Enhanced recommendation for low ROAS
        if (campaign.roas && campaign.roas < 2.0 && campaign.spend && campaign.spend > 100) {
          // Find relevant training materials for low ROAS scenarios
          const roasOptimizationMaterials = campaignOptimizationMaterials.filter(m => 
            m.title.toLowerCase().includes('roas') || 
            m.title.toLowerCase().includes('bid') ||
            m.content.toLowerCase().includes('roas optimization') ||
            m.tags?.some(tag => ['roas', 'bidding', 'optimization'].includes(tag.toLowerCase()))
          );
          
          let enhancedReason = 'Low ROAS detected. Reducing bid to improve cost efficiency.';
          let enhancedImpact = 'Expected 10-15% improvement in ROAS';
          let confidence = 0.85;
          
          // Enhance recommendation with training materials insights
          if (roasOptimizationMaterials.length > 0) {
            const bestMaterial = roasOptimizationMaterials[0]; // Use most relevant material
            
            // Update material usage statistics
            await storage.updateTrainingMaterialUsage(bestMaterial.id);
            
            enhancedReason += ` Based on training material "${bestMaterial.title}", additional strategies include optimizing audience targeting and creative testing.`;
            enhancedImpact = 'Expected 15-25% improvement in ROAS with comprehensive optimization approach';
            confidence = 0.92; // Higher confidence with training material backing
          }
          
          recommendations.push({
            clientId,
            campaignId: campaign.id,
            recommendationType: 'bid_adjustment',
            currentValue: campaign.cpc || 0,
            recommendedValue: (campaign.cpc || 0) * 0.85, // Reduce bid by 15%
            reason: enhancedReason,
            confidence,
            expectedImpact: enhancedImpact
          });
        }

        // AI-Enhanced recommendation for low impression volume
        if (campaign.impressions && campaign.impressions < 1000 && campaign.cpc && campaign.cpc < 1.0) {
          // Find relevant training materials for impression optimization
          const impressionMaterials = campaignOptimizationMaterials.filter(m => 
            m.title.toLowerCase().includes('impression') || 
            m.title.toLowerCase().includes('visibility') ||
            m.content.toLowerCase().includes('impression optimization') ||
            m.tags?.some(tag => ['impressions', 'visibility', 'reach'].includes(tag.toLowerCase()))
          );
          
          let enhancedReason = 'Low impression volume. Increasing bid to improve visibility.';
          let enhancedImpact = 'Expected 20-30% increase in impressions';
          let confidence = 0.75;
          
          if (impressionMaterials.length > 0) {
            const bestMaterial = impressionMaterials[0];
            await storage.updateTrainingMaterialUsage(bestMaterial.id);
            
            enhancedReason += ` Training material "${bestMaterial.title}" suggests also reviewing audience size and targeting parameters for optimal reach.`;
            enhancedImpact = 'Expected 30-45% increase in impressions with enhanced targeting';
            confidence = 0.88;
          }
          
          recommendations.push({
            clientId,
            campaignId: campaign.id,
            recommendationType: 'bid_adjustment',
            currentValue: campaign.cpc,
            recommendedValue: campaign.cpc * 1.2, // Increase bid by 20%
            reason: enhancedReason,
            confidence,
            expectedImpact: enhancedImpact
          });
        }

        // AI-Enhanced budget reallocation for high performers
        if (campaign.roas && campaign.roas > 4.0 && campaign.spend && campaign.spend > 50) {
          // Find relevant training materials for scaling strategies
          const scalingMaterials = campaignOptimizationMaterials.filter(m => 
            m.title.toLowerCase().includes('scaling') || 
            m.title.toLowerCase().includes('budget') ||
            m.content.toLowerCase().includes('budget optimization') ||
            m.tags?.some(tag => ['scaling', 'budget', 'growth'].includes(tag.toLowerCase()))
          );
          
          let enhancedReason = 'High-performing campaign with excellent ROAS. Scaling budget to maximize returns.';
          let enhancedImpact = 'Expected 25-40% increase in total revenue';
          let confidence = 0.9;
          
          if (scalingMaterials.length > 0) {
            const bestMaterial = scalingMaterials[0];
            await storage.updateTrainingMaterialUsage(bestMaterial.id);
            
            enhancedReason += ` Training material "${bestMaterial.title}" recommends gradual scaling with careful monitoring of key metrics.`;
            enhancedImpact = 'Expected 35-50% increase in total revenue with strategic scaling approach';
            confidence = 0.95;
          }
          
          recommendations.push({
            clientId,
            campaignId: campaign.id,
            recommendationType: 'budget_increase',
            currentValue: campaign.spend,
            recommendedValue: campaign.spend * 1.3, // Increase budget by 30%
            reason: enhancedReason,
            confidence,
            expectedImpact: enhancedImpact
          });
        }
      }

      // Create recommendations in database
      const createdRecommendations = [];
      for (const rec of recommendations) {
        const created = await storage.createOptimizationRecommendation(rec);
        createdRecommendations.push(created);
      }

      // Track user activity
      await trackUserActivity(
        (req as any).trackingUserId,
        (req as any).trackingSessionId,
        "ai_optimization",
        {
          clientId,
          campaignsAnalyzed: campaigns.length,
          recommendationsGenerated: createdRecommendations.length
        }
      );

      res.json({
        message: `Generated ${createdRecommendations.length} optimization recommendations`,
        recommendations: createdRecommendations,
        campaignsAnalyzed: campaigns.length
      });

    } catch (error: any) {
      console.error("Error generating recommendations:", error);
      res.status(500).json({ message: "Failed to generate recommendations", error: error.message });
    }
  });

  // Campaign Results Tracking
  app.get("/api/ads/results", isAdmin, async (req, res) => {
    try {
      const { clientId } = req.query;
      const results = await storage.getCampaignResults(clientId as string || undefined);
      res.json(results);
    } catch (error: any) {
      console.error("Error fetching campaign results:", error);
      res.status(500).json({ message: "Failed to fetch results", error: error.message });
    }
  });

  app.post("/api/ads/results", isAdmin, async (req, res) => {
    try {
      const validationResult = insertCampaignResultSchema.safeParse(req.body);
      if (!validationResult.success) {
        const errorDetails = fromZodError(validationResult.error);
        return res.status(400).json({ message: "Invalid result data", error: errorDetails });
      }

      const newResult = await storage.createCampaignResult(validationResult.data);
      res.status(201).json(newResult);
    } catch (error: any) {
      console.error("Error creating campaign result:", error);
      res.status(500).json({ message: "Failed to create result", error: error.message });
    }
  });

  // Product URL scraping endpoint
  app.post("/api/scrape-product", async (req, res) => {
    try {
      // Rate limiting check
      const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
      if (!checkRateLimit(clientIP)) {
        return res.status(429).json({
          message: "Too many requests. Please try again later.",
          error: "Rate limit exceeded",
          type: "rate_limit"
        });
      }

      // Validate request body
      const validationResult = scrapeProductRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        const errorDetails = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
        return res.status(400).json({ 
          message: "Invalid URL provided",
          error: errorDetails,
          type: "validation_error"
        });
      }
      
      const { url } = validationResult.data;

      // Track user activity
      await trackUserActivity(
        (req as any).trackingUserId,
        (req as any).trackingSessionId,
        "scrape_product",
        {
          url: new URL(url).hostname, // Only store hostname for privacy
        }
      );

      // Scrape the product
      console.log(`Scraping product from URL: ${url}`);
      const scrapedProduct = await scrapeProductFromUrl(url);

      if (!scrapedProduct.success) {
        return res.status(400).json({
          message: "Failed to extract product information from the URL",
          error: scrapedProduct.error || "Scraping failed",
          type: "scraping_error"
        });
      }

      // Return the scraped product data
      res.json(scrapedProduct);

    } catch (error: any) {
      console.error('Product scraping endpoint error:', error);
      
      // Handle various error types
      if (error.name === 'TypeError' && error.message.includes('Invalid URL')) {
        res.status(400).json({ 
          message: "Invalid URL format. Please provide a valid product URL.", 
          error: "Invalid URL",
          type: "validation_error"
        });
      } else {
        // Generic error handling
        res.status(500).json({ 
          message: "Failed to scrape product information. Please try again.", 
          error: error.message || "Unknown error",
          type: "generic_error"
        });
      }
    }
  });

  // ==========================================
  // TRAINING MATERIALS API ROUTES
  // ==========================================

  // Get all training materials with filtering
  app.get("/api/training-materials", isAdmin, async (req, res) => {
    try {
      const { documentType, category, isActive } = req.query;
      const materials = await storage.getTrainingMaterials(
        documentType as string || undefined,
        category as string || undefined,
        isActive ? isActive === 'true' : undefined
      );
      res.json(materials);
    } catch (error: any) {
      console.error("Error fetching training materials:", error);
      res.status(500).json({ message: "Failed to fetch training materials", error: error.message });
    }
  });

  // Get specific training material
  app.get("/api/training-materials/:id", isAdmin, async (req, res) => {
    try {
      const material = await storage.getTrainingMaterial(req.params.id);
      if (!material) {
        return res.status(404).json({ message: "Training material not found" });
      }
      res.json(material);
    } catch (error: any) {
      console.error("Error fetching training material:", error);
      res.status(500).json({ message: "Failed to fetch training material", error: error.message });
    }
  });

  // Create new training material
  app.post("/api/training-materials", isAdmin, async (req, res) => {
    try {
      const validationResult = insertTrainingMaterialSchema.safeParse(req.body);
      if (!validationResult.success) {
        const errorDetails = fromZodError(validationResult.error);
        return res.status(400).json({ message: "Invalid training material data", error: errorDetails });
      }

      const newMaterial = await storage.createTrainingMaterial(validationResult.data);
      
      // Track activity
      await trackUserActivity(
        (req as any).trackingUserId,
        (req as any).trackingSessionId,
        "training_material_created",
        {
          materialId: newMaterial.id,
          documentType: newMaterial.documentType,
          category: newMaterial.category
        }
      );

      res.status(201).json(newMaterial);
    } catch (error: any) {
      console.error("Error creating training material:", error);
      res.status(500).json({ message: "Failed to create training material", error: error.message });
    }
  });

  // Upload training material file
  app.post("/api/training-materials/upload", isAdmin, trainingMaterialUpload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { title, description, documentType, category, tags, authorName, authorEmail, isPublic } = req.body;

      if (!title || !documentType) {
        return res.status(400).json({ message: "Title and document type are required" });
      }

      // Extract text content from file
      let content = "";
      const mimeType = req.file.mimetype;

      if (mimeType === "text/plain" || mimeType === "text/markdown") {
        content = req.file.buffer.toString('utf8');
      } else if (mimeType === "application/pdf") {
        // For PDF files, store a placeholder and file info
        content = `PDF document: ${req.file.originalname}\n\nThis is a PDF file. The content will be processed separately for text extraction.`;
      } else {
        return res.status(400).json({ message: "Unsupported file type. Please upload text, markdown, or PDF files." });
      }

      const materialData = {
        title,
        description: description || undefined,
        content,
        documentType,
        category: category || undefined,
        tags: tags ? tags.split(',').map((tag: string) => tag.trim()) : undefined,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        mimeType,
        source: 'upload',
        authorName: authorName || undefined,
        authorEmail: authorEmail || undefined,
        isPublic: isPublic === 'true'
      };

      const validationResult = insertTrainingMaterialSchema.safeParse(materialData);
      if (!validationResult.success) {
        const errorDetails = fromZodError(validationResult.error);
        return res.status(400).json({ message: "Invalid training material data", error: errorDetails });
      }

      const newMaterial = await storage.createTrainingMaterial(validationResult.data);

      // Track activity
      await trackUserActivity(
        (req as any).trackingUserId,
        (req as any).trackingSessionId,
        "training_material_uploaded",
        {
          materialId: newMaterial.id,
          fileName: req.file.originalname,
          fileSize: req.file.size,
          documentType: newMaterial.documentType
        }
      );

      res.status(201).json(newMaterial);
    } catch (error: any) {
      console.error("Error uploading training material:", error);
      res.status(500).json({ message: "Failed to upload training material", error: error.message });
    }
  });

  // Update training material
  app.put("/api/training-materials/:id", isAdmin, async (req, res) => {
    try {
      const validationResult = insertTrainingMaterialSchema.partial().safeParse(req.body);
      if (!validationResult.success) {
        const errorDetails = fromZodError(validationResult.error);
        return res.status(400).json({ message: "Invalid training material data", error: errorDetails });
      }

      const updatedMaterial = await storage.updateTrainingMaterial(req.params.id, validationResult.data);
      res.json(updatedMaterial);
    } catch (error: any) {
      console.error("Error updating training material:", error);
      res.status(500).json({ message: "Failed to update training material", error: error.message });
    }
  });

  // Delete training material
  app.delete("/api/training-materials/:id", isAdmin, async (req, res) => {
    try {
      await storage.deleteTrainingMaterial(req.params.id);
      
      // Track activity
      await trackUserActivity(
        (req as any).trackingUserId,
        (req as any).trackingSessionId,
        "training_material_deleted",
        {
          materialId: req.params.id
        }
      );

      res.json({ message: "Training material deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting training material:", error);
      res.status(500).json({ message: "Failed to delete training material", error: error.message });
    }
  });

  // Search training materials
  app.get("/api/training-materials/search", isAdmin, async (req, res) => {
    try {
      const { q, documentType, category } = req.query;
      
      if (!q || typeof q !== 'string') {
        return res.status(400).json({ message: "Search query is required" });
      }

      const materials = await storage.searchTrainingMaterials(
        q,
        documentType as string || undefined,
        category as string || undefined
      );

      // Track search activity
      await trackUserActivity(
        (req as any).trackingUserId,
        (req as any).trackingSessionId,
        "training_materials_search",
        {
          query: q,
          resultsCount: materials.length,
          documentType,
          category
        }
      );

      res.json(materials);
    } catch (error: any) {
      console.error("Error searching training materials:", error);
      res.status(500).json({ message: "Failed to search training materials", error: error.message });
    }
  });

  // Get training materials by tags
  app.post("/api/training-materials/by-tags", isAdmin, async (req, res) => {
    try {
      const { tags } = req.body;
      
      if (!Array.isArray(tags) || tags.length === 0) {
        return res.status(400).json({ message: "Tags array is required" });
      }

      const materials = await storage.getTrainingMaterialsByTags(tags);
      res.json(materials);
    } catch (error: any) {
      console.error("Error fetching training materials by tags:", error);
      res.status(500).json({ message: "Failed to fetch training materials", error: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}