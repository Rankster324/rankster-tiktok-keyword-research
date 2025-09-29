import type { Express } from "express";
import { createServer, type Server } from "http";
import { 
  insertEmailSubscriberSchema,
  insertCategorySchema,
  insertKeywordSchema,
  updateKeywordSchema,
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
import csvParser from "csv-parser";
import * as XLSX from "xlsx";
import { db } from "./db";
import { keywords } from "../shared/schema";
import { sql, eq, and, desc } from "drizzle-orm";

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
    // Don't throw error - activity tracking should not break core functionality
    return;
  }
}

// Beehiiv API integration
async function addToBeehiivNewsletter(email: string, retryCount: number = 0): Promise<{ success: boolean; error?: string; statusCode?: number }> {
  try {
    const apiKey = process.env.BEEHIIV_API_KEY;
    const publicationId = process.env.BEEHIIV_PUBLICATION_ID;

    if (!apiKey || !publicationId) {
      console.warn('Beehiiv API credentials not found, skipping newsletter subscription');
      return { success: false, error: 'API credentials not configured' };
    }

    const response = await fetch('https://api.beehiiv.com/v2/subscribers', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email,
        reactivate_existing: false,
        send_welcome_email: true,
        utm_source: 'rankster_website',
        utm_medium: 'organic',
        utm_campaign: 'signup',
        referring_site: 'rankster.co',
        publication_id: publicationId
      }),
    });

    const responseData = await response.text();
    console.log('Beehiiv response status:', response.status);
    console.log('Beehiiv response:', responseData);
    
    let parsedData;
    try {
      parsedData = JSON.parse(responseData);
    } catch (e) {
      console.error('Failed to parse Beehiiv response as JSON:', responseData);
      return { success: false, error: 'Invalid response format', statusCode: response.status };
    }

    if (response.ok) {
      return { success: true };
    } else if (response.status === 409) {
      // User already exists, which is fine
      console.log('User already subscribed to newsletter:', email);
      return { success: true };
    } else if (response.status >= 500 && retryCount < 3) {
      // Retry on server errors
      console.log(`Retrying Beehiiv API call (attempt ${retryCount + 1})...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
      return addToBeehiivNewsletter(email, retryCount + 1);
    } else {
      return { 
        success: false, 
        error: parsedData?.errors?.[0]?.detail || `API error: ${response.status}`,
        statusCode: response.status 
      };
    }
  } catch (error: any) {
    console.error('Beehiiv API error:', error);
    if (retryCount < 3) {
      console.log(`Retrying Beehiiv API call (attempt ${retryCount + 1})...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
      return addToBeehiivNewsletter(email, retryCount + 1);
    }
    return { success: false, error: error.message || 'Network error' };
  }
}

// Training materials file upload configuration
const trainingMaterialStorage = multer.memoryStorage();
const trainingMaterialUpload = multer({
  storage: trainingMaterialStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept text files, PDFs, docs
    const allowedTypes = [
      'text/plain',
      'text/markdown',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Please upload text, markdown, or PDF files.'));
    }
  }
});

export function registerRoutes(app: Express): Server {
  // Initialize Replit authentication
  setupAuth(app);

  // User activity tracking middleware
  app.use('/api', async (req, res, next) => {
    if (!req.session) {
      return next();
    }

    // Generate or get session tracking ID
    let trackingSessionId = (req as any).trackingSessionId;
    if (!trackingSessionId) {
      trackingSessionId = generateSessionId();
      (req as any).trackingSessionId = trackingSessionId;
      
      // Create user session record
      try {
        const userId = (req.session as any)?.user?.id || (req.session as any)?.adminUser?.id || null;
        const userSession = await storage.createUserSession({
          userId: userId,
          sessionId: req.sessionID,
          userAgent: req.get('User-Agent') || null,
          ipAddress: req.ip || req.connection.remoteAddress || null,
          startTime: new Date()
        });
        // Update tracking session ID to use the generated ID
        trackingSessionId = userSession.id;
        (req as any).trackingSessionId = trackingSessionId;
      } catch (error) {
        console.error('Failed to create user session:', error);
      }
    }

    // Track search activities
    if (req.path.includes('/search') || req.path.includes('/keywords')) {
      const userId = (req.session as any)?.user?.id || (req.session as any)?.adminUser?.id || null;
      
      // Only track actual usage, not just page loads
      if (req.method === 'GET' && req.query.q) {
        await trackUserActivity(
          userId,
          trackingSessionId,
          'keyword_search',
          { 
            query: req.query.q,
            category: req.query.category,
            page: req.query.page 
          }
        );
      }
    }

    next();
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
        
        // Generate proper session ID
        const sessionId = generateSessionId();
        (req as any).trackingSessionId = sessionId;
        
        // Set session using the DB user data
        (req.session as any).adminUser = {
          id: dbUser.id,
          email: dbUser.email,
          role: 'admin',
          firstName: dbUser.firstName,
          lastName: dbUser.lastName
        };
        (req.session as any).trackingSessionId = sessionId;
        
        console.log('Session set:', (req.session as any).adminUser);
        await new Promise((resolve) => req.session.save(resolve));

        // Create user session record for admin login
        try {
          const adminUserSession = await storage.createUserSession({
            userId: dbUser.id,
            sessionId: req.sessionID,
            userAgent: req.get('User-Agent') || null,
            ipAddress: req.ip || req.connection.remoteAddress || null,
            startTime: new Date()
          });
          // Update session ID to use the generated ID
          const newSessionId = adminUserSession.id;
          (req as any).trackingSessionId = newSessionId;
          (req.session as any).trackingSessionId = newSessionId;
        } catch (error) {
          console.error('Failed to create admin user session:', error);
        }

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

  // User session check endpoint
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

  // Logout endpoints
  app.post('/api/admin/logout', (req, res) => {
    (req.session as any).adminUser = null;
    res.json({ success: true });
  });

  app.post('/api/auth/logout', (req, res) => {
    (req.session as any).user = null;
    (req.session as any).adminUser = null;
    res.json({ success: true });
  });

  // Admin statistics endpoints
  app.get('/api/admin/stats/daily', isAdmin, async (req, res) => {
    try {
      const dailyStats = await storage.getUserActivities();
      res.json(dailyStats);
    } catch (error) {
      console.error('Error fetching daily stats:', error);
      res.status(500).json({ message: 'Failed to fetch daily stats' });
    }
  });

  app.get('/api/admin/stats/weekly', isAdmin, async (req, res) => {
    try {
      const weeklyStats = await storage.getUserActivities();
      res.json(weeklyStats);
    } catch (error) {
      console.error('Error fetching weekly stats:', error);
      res.status(500).json({ message: 'Failed to fetch weekly stats' });
    }
  });

  app.get('/api/admin/stats/monthly', isAdmin, async (req, res) => {
    try {
      const monthlyStats = await storage.getMonthlyUsageStats();
      res.json(monthlyStats);
    } catch (error) {
      console.error('Error fetching monthly stats:', error);
      res.status(500).json({ message: 'Failed to fetch monthly stats' });
    }
  });

  app.get('/api/admin/stats/activities', isAdmin, async (req, res) => {
    try {
      const activities = await storage.getUserActivities();
      res.json(activities);
    } catch (error) {
      console.error('Error fetching activities:', error);
      res.status(500).json({ message: 'Failed to fetch activities' });
    }
  });

  app.get('/api/admin/stats/overview', isAdmin, async (req, res) => {
    try {
      const overview = await storage.getUserActivities();
      res.json(overview);
    } catch (error) {
      console.error('Error fetching overview:', error);
      res.status(500).json({ message: 'Failed to fetch overview' });
    }
  });

  // Beehiiv integration endpoints
  app.post('/api/admin/sync-beehiiv', isAdmin, async (req, res) => {
    try {
      const subscribers = await storage.getEmailSubscribers();
      const results = [];
      
      for (const subscriber of subscribers) {
        const result = await addToBeehiivNewsletter(subscriber.email);
        results.push({
          email: subscriber.email,
          success: result.success,
          error: result.error
        });
      }
      
      res.json({ results });
    } catch (error) {
      console.error('Beehiiv sync error:', error);
      res.status(500).json({ message: 'Failed to sync with Beehiiv' });
    }
  });

  app.post('/api/admin/test-beehiiv', isAdmin, async (req, res) => {
    try {
      const testEmail = req.body.email || 'test@example.com';
      const result = await addToBeehiivNewsletter(testEmail);
      res.json(result);
    } catch (error) {
      console.error('Beehiiv test error:', error);
      res.status(500).json({ message: 'Failed to test Beehiiv' });
    }
  });

  // Activity tracking endpoint
  app.post('/api/activity/track', async (req, res) => {
    try {
      const { activityType, activityData } = req.body;
      const userId = (req.session as any)?.user?.id || (req.session as any)?.adminUser?.id || null;
      
      await trackUserActivity(
        userId,
        (req as any).trackingSessionId,
        activityType,
        activityData
      );
      
      res.json({ success: true });
    } catch (error) {
      console.error('Activity tracking error:', error);
      res.status(500).json({ message: 'Failed to track activity' });
    }
  });

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
      
      // Check if already subscribed
      const existingSubscriber = await storage.getEmailSubscriber(email);
      if (existingSubscriber) {
        return res.json({ message: "Already subscribed to newsletter" });
      }

      // Add to local database
      await storage.createEmailSubscriber({ email });

      // Add to Beehiiv newsletter
      const beehiivResult = await addToBeehiivNewsletter(email);
      
      if (beehiivResult.success) {
        console.log('User successfully subscribed to Beehiiv newsletter:', email);
        res.json({ message: "Successfully subscribed to newsletter" });
      } else {
        console.error(`Failed to add ${email} to Beehiiv:`, beehiivResult.error);
        // Still return success since we saved locally
        res.json({ 
          message: "Subscribed locally, newsletter sync pending",
          warning: "External newsletter service temporarily unavailable"
        });
      }
    } catch (error: any) {
      if (error.name === "ZodError") {
        const validationError = fromZodError(error);
        return res.status(400).json({ message: validationError.toString() });
      }
      console.error("Subscription error:", error);
      res.status(500).json({ message: "Failed to subscribe" });
    }
  });

  // Get subscriber count
  app.get("/api/subscriber-count", async (req, res) => {
    try {
      const count = await storage.getEmailSubscribersCount();
      res.json({ count });
    } catch (error) {
      console.error("Error fetching subscriber count:", error);
      res.status(500).json({ message: "Failed to fetch subscriber count" });
    }
  });

  // Categories endpoints
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

  // Keyword search endpoint
  app.get("/api/keywords/search", async (req, res) => {
    try {
      const { q, query, category, subCategory1, subCategory2, uploadPeriod, page, limit, sortFields, sortDirections, searchMetric } = req.query;
      const searchQuery = (q || query) as string;
      const uploadPeriodStr = uploadPeriod as string;
      const searchMetricStr = searchMetric as string || 'top';
      
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

  // Admin categories endpoint
  app.get("/api/admin/categories", isAdmin, async (req, res) => {
    try {
      const categories = await storage.getCategories();
      res.json(categories);
    } catch (error) {
      console.error("Error fetching admin categories:", error);
      res.status(500).json({ message: "Failed to fetch categories" });
    }
  });

  // Admin upload management endpoints
  // Get list of uploads
  app.get("/api/admin/uploads", isAdmin, async (req, res) => {
    try {
      const result = await db
        .select({
          uploadPeriod: keywords.uploadPeriod,
          isHpk: keywords.isHpk,
          isRk: keywords.isRk,
          totalKeywords: sql<number>`count(*)`,
          uniqueKeywords: sql<number>`count(distinct ${keywords.keyword})`,
          firstUploaded: sql<string>`min(${keywords.createdAt})`,
          lastUploaded: sql<string>`max(${keywords.createdAt})`
        })
        .from(keywords)
        .where(eq(keywords.isActive, true))
        .groupBy(keywords.uploadPeriod, keywords.isHpk, keywords.isRk)
        .orderBy(desc(keywords.uploadPeriod));

      const uploads = result.map(row => ({
        uploadPeriod: row.uploadPeriod,
        uploadType: row.isHpk ? 'HPK' : row.isRk ? 'RK' : 'Regular',
        totalKeywords: Number(row.totalKeywords),
        uniqueKeywords: Number(row.uniqueKeywords),
        firstUploaded: row.firstUploaded,
        lastUploaded: row.lastUploaded
      }));

      res.json(uploads);
    } catch (error) {
      console.error("Error fetching uploads:", error);
      res.status(500).json({ message: "Failed to fetch uploads" });
    }
  });

  // Delete upload by period and type
  app.delete("/api/admin/uploads/:uploadPeriod/:uploadType", isAdmin, async (req, res) => {
    try {
      const { uploadPeriod, uploadType } = req.params;
      
      let whereConditions = [
        eq(keywords.uploadPeriod, uploadPeriod),
        eq(keywords.isActive, true)
      ];

      // Add type-specific conditions
      if (uploadType === 'HPK') {
        whereConditions.push(eq(keywords.isHpk, true));
      } else if (uploadType === 'RK') {
        whereConditions.push(eq(keywords.isRk, true));
      } else if (uploadType === 'Regular') {
        whereConditions.push(eq(keywords.isHpk, false));
        whereConditions.push(eq(keywords.isRk, false));
      } else {
        return res.status(400).json({ message: "Invalid upload type. Must be Regular, HPK, or RK" });
      }

      const deleteResult = await db
        .delete(keywords)
        .where(and(...whereConditions));

      res.json({ 
        message: `Successfully deleted ${uploadType} upload for period ${uploadPeriod}`,
        deletedCount: deleteResult.rowCount || 0
      });
    } catch (error) {
      console.error("Error deleting upload:", error);
      res.status(500).json({ message: "Failed to delete upload" });
    }
  });

  // Admin keyword CRUD endpoints
  // Get total keyword count
  app.get("/api/admin/keywords/count", isAdmin, async (req, res) => {
    try {
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(keywords)
        .execute();
      
      const totalCount = Number(result[0]?.count) || 0;
      res.json({ totalKeywords: totalCount });
    } catch (error) {
      console.error("Error fetching keyword count:", error);
      res.status(500).json({ message: "Internal server error" });
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

  // CSV Upload Configuration
  const csvUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB limit
    },
    fileFilter: (req, file, cb) => {
      const isCSV = file.mimetype === 'text/csv' || file.originalname.endsWith('.csv');
      const isExcel = file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                     file.mimetype === 'application/vnd.ms-excel' ||
                     file.originalname.endsWith('.xlsx') ||
                     file.originalname.endsWith('.xls');
      
      if (isCSV || isExcel) {
        cb(null, true);
      } else {
        cb(new Error('Only CSV and Excel files are allowed'));
      }
    }
  });

  // Helper function to get column value with flexible naming
  function getColumnValue(row: any, ...possibleNames: string[]): string {
    for (const name of possibleNames) {
      if (row[name] !== undefined && row[name] !== null && row[name] !== '') {
        return String(row[name]).trim();
      }
    }
    return '';
  }

  // CSV Column Mapping Function
  function mapCsvRowToKeyword(row: any, uploadPeriod: string, isFirstRow = false): any {
    // Debug: Log column names from first row to identify price column
    if (isFirstRow) {
      console.log('CSV columns available:', Object.keys(row));
      const priceColumns = Object.keys(row).filter(key => 
        key.toLowerCase().includes('price') || 
        key.toLowerCase().includes('avg')
      );
      console.log('Potential price column names:', priceColumns);
      
      // Try to get price value and log what we find
      const priceValue = getColumnValue(row, 'Avg. price', 'average_price', 'averagePrice', 'AVG_PRICE', 'avg_price', 'Price', 'price', 'PRICE', 'Average Price', 'Avg Price', 'AvgPrice', 'Avg_Price');
      console.log('Price value found:', priceValue, 'from row:', row);
    }
    
    // Parse the date range (e.g., "May 01, 2025 - May 31, 2025")
    const dateStr = getColumnValue(row, 'Date', 'date') || '';
    let startDate = '';
    let endDate = '';
    
    if (dateStr.includes(' - ')) {
      const [start, end] = dateStr.split(' - ');
      startDate = new Date(start.trim()).toISOString().split('T')[0];
      endDate = new Date(end.trim()).toISOString().split('T')[0];
    } else {
      // Fallback to upload period - handle both "YYYY-MM" and "YYYYMM" formats
      let year: string, month: string;
      
      if (uploadPeriod.includes('-')) {
        // Format: "YYYY-MM"
        [year, month] = uploadPeriod.split('-');
      } else if (uploadPeriod.length === 6 && /^\d{6}$/.test(uploadPeriod)) {
        // Format: "YYYYMM"
        year = uploadPeriod.substring(0, 4);
        month = uploadPeriod.substring(4, 6);
      } else {
        // Fallback: use current date
        const now = new Date();
        year = now.getFullYear().toString();
        month = (now.getMonth() + 1).toString().padStart(2, '0');
      }
      
      startDate = `${year}-${month}-01`;
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
      endDate = `${year}-${month}-${lastDay.toString().padStart(2, '0')}`;
    }

    return {
      keyword: getColumnValue(row, 'Keyword', 'keyword', 'KEYWORD'),
      searchVolume: parseInt(getColumnValue(row, 'Search volume', 'search_volume', 'searchVolume', 'SEARCH_VOLUME') || '0') || 0,
      productClickScore: parseFloat(getColumnValue(row, 'Product click score', 'product_click_score', 'productClickScore', 'PRODUCT_CLICK_SCORE') || '0') || 0,
      skuSalesScore: parseFloat(getColumnValue(row, 'SKU sales score', 'sku_sales_score', 'skuSalesScore', 'SKU_SALES_SCORE', 'Opportunity score', 'opportunity_score', 'OpportunityScore', 'OPPORTUNITY_SCORE') || '0') || 0,
      availableProducts: parseInt(getColumnValue(row, 'Available products', 'available_products', 'availableProducts', 'AVAILABLE_PRODUCTS') || '0') || 0,
      averagePrice: (() => {
        // Get the raw price value without any fallback first
        const rawPriceValue = getColumnValue(row, 'Avg. price', 'average_price', 'averagePrice', 'AVG_PRICE', 'avg_price', 'Price', 'price', 'PRICE', 'Average Price', 'Avg Price', 'AvgPrice', 'Avg_Price');
        
        if (isFirstRow) {
          console.log('=== PRICE PARSING DEBUG ===');
          console.log('Raw price value:', rawPriceValue);
          console.log('Type:', typeof rawPriceValue);
          console.log('All column keys:', Object.keys(row));
          
          // Check if any column contains "price" or "avg"
          const priceColumns = Object.keys(row).filter(key => 
            key.toLowerCase().includes('price') || key.toLowerCase().includes('avg')
          );
          console.log('Price-related columns:', priceColumns);
          priceColumns.forEach(col => {
            console.log(`${col}: ${row[col]} (type: ${typeof row[col]})`);
          });
          console.log('========================');
        }
        
        // If null or undefined, return 0 
        if (rawPriceValue === null || rawPriceValue === undefined) {
          return 0;
        }
        
        // Convert to string and clean
        let cleanedValue = String(rawPriceValue).trim();
        
        // Remove currency symbols and thousand separators
        cleanedValue = cleanedValue.replace(/[\$,£€¥]/g, '');
        
        // Handle European decimal comma format (convert to dot)
        if (cleanedValue.includes(',') && !cleanedValue.includes('.')) {
          cleanedValue = cleanedValue.replace(',', '.');
        } else if (cleanedValue.includes(',') && cleanedValue.includes('.')) {
          // Format like "1,234.56" - remove commas
          cleanedValue = cleanedValue.replace(/,/g, '');
        }
        
        const parsed = parseFloat(cleanedValue);
        
        if (isFirstRow) {
          console.log('Cleaned value:', cleanedValue);
          console.log('Parsed result:', parsed);
          console.log('Is NaN:', isNaN(parsed));
        }
        
        return isNaN(parsed) ? 0 : parsed;
      })(),
      ctrScore: parseFloat(getColumnValue(row, 'CTR score', 'ctr_score', 'ctrScore', 'CTR_SCORE') || '0') || 0,
      ctorScore: parseFloat(getColumnValue(row, 'CTOR score', 'ctor_score', 'ctorScore', 'CTOR_SCORE') || '0') || 0,
      category: getColumnValue(row, 'Category', 'category', 'CATEGORY'),
      subCategory1: getColumnValue(row, 'Sub Category 1', 'sub_category_1', 'subCategory1', 'SUB_CATEGORY_1'),
      subCategory2: getColumnValue(row, 'Sub Category 2', 'sub_category_2', 'subCategory2', 'SUB_CATEGORY_2'),
      uploadPeriod: uploadPeriod,
      startDate: startDate,
      endDate: endDate,
      isActive: true,
      isHpk: false, // Regular keywords
      isRk: false,
      rank: null
    };
  }


  // CSV Upload Endpoint
  // Development-only test endpoint for price parsing validation
  if (process.env.NODE_ENV === 'development') {
    app.get("/api/dev/test-price-parsing", async (req, res) => {
      console.log('=== TESTING PRICE PARSING (DEV MODE) ===');
      
      // Test different price formats that might be in the user's CSV
      const testCases = [
        { name: 'Dollar with symbol', data: { 'Avg. price': '$12.99', 'Keyword': 'test1' }},
        { name: 'Plain number', data: { 'Avg. price': '12.99', 'Keyword': 'test2' }},
        { name: 'With comma separator', data: { 'Avg. price': '$1,234.56', 'Keyword': 'test3' }},
        { name: 'European format', data: { 'Avg. price': '12,99', 'Keyword': 'test4' }},
        { name: 'Empty value', data: { 'Avg. price': '', 'Keyword': 'test5' }},
        { name: 'Zero value', data: { 'Avg. price': '0.00', 'Keyword': 'test6' }},
      ];
      
      const results = [];
      
      for (const testCase of testCases) {
        try {
          console.log(`Testing: ${testCase.name}`);
          const parsed = mapCsvRowToKeyword(testCase.data, '2025-05', true);
          const result = {
            testName: testCase.name,
            input: testCase.data['Avg. price'],
            output: parsed.averagePrice,
            success: true
          };
          console.log(`Result: ${testCase.name} -> ${result.output}`);
          results.push(result);
        } catch (error) {
          console.error(`Error in ${testCase.name}:`, error);
          results.push({
            testName: testCase.name,
            input: testCase.data['Avg. price'],
            output: null,
            error: error instanceof Error ? error.message : 'Unknown error',
            success: false
          });
        }
      }
      
      res.json({
        success: true,
        testResults: results,
        summary: {
          passed: results.filter(r => r.success && r.output > 0).length,
          failed: results.filter(r => !r.success).length,
          zeros: results.filter(r => r.success && r.output === 0).length
        }
      });
    });
  }

  app.post("/api/admin/keywords/upload-csv-simple", isAdmin, csvUpload.single("csvFile"), async (req, res) => {
    console.log('=== CSV UPLOAD ENDPOINT HIT ===');
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No CSV file uploaded" });
      }

      const { uploadPeriod, keywordType = 'regular' } = req.body;
      
      if (!uploadPeriod) {
        return res.status(400).json({ message: "Upload period is required (e.g., '2025-05')" });
      }

      const csvContent = req.file.buffer.toString('utf8');
      console.log('Processing CSV upload:', {
        filename: req.file.originalname,
        size: req.file.size,
        uploadPeriod,
        keywordType
      });

      // Determine file type and parse accordingly
      const fileName = req.file.originalname.toLowerCase();
      const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || 
                     req.file.mimetype.includes('spreadsheet') || req.file.mimetype.includes('excel');
      
      let rows: any[] = [];

      if (isExcel) {
        // Parse Excel file
        try {
          const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
          const sheetName = workbook.SheetNames[0]; // Use first sheet
          const worksheet = workbook.Sheets[sheetName];
          rows = XLSX.utils.sheet_to_json(worksheet);
          console.log(`Parsed ${rows.length} rows from Excel file`);
        } catch (error) {
          console.error('Error parsing Excel file:', error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return res.status(400).json({ message: "Failed to parse Excel file", error: errorMessage });
        }
      } else {
        // Parse CSV file
        const stream = csvParser();
        
        await new Promise((resolve, reject) => {
          stream.on('data', (row) => {
            rows.push(row);
          });

          stream.on('end', () => {
            console.log(`Parsed ${rows.length} rows from CSV`);
            resolve(null);
          });

          stream.on('error', (error) => {
            console.error('CSV parsing error:', error);
            reject(error);
          });

          // Write CSV content to stream
          if (req.file) {
            stream.write(req.file.buffer);
          }
          stream.end();
        });
      }

      // Process rows (same logic for both Excel and CSV)
      if (rows.length === 0) {
        return res.status(400).json({ message: "File is empty or invalid" });
      }

      // Process and insert keywords in batches
      const batchSize = 100;
      const results = { inserted: 0, errors: [] as any[] };

      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(rows.length/batchSize)}`);

        for (const row of batch) {
          try {
            const isFirstRowOfUpload = i === 0 && batch.indexOf(row) === 0;
            if (isFirstRowOfUpload) {
              console.log('=== FIRST ROW DEBUG ===');
              console.log('Available columns:', Object.keys(row));
              console.log('Avg. price column value:', row['Avg. price']);
              console.log('======================');
            }
            const keywordData = mapCsvRowToKeyword(row, uploadPeriod, isFirstRowOfUpload);
            
            // Set keyword type flags
            if (keywordType === 'hpk') {
              keywordData.isHpk = true;
              keywordData.isRk = false;
            } else if (keywordType === 'rising') {
              keywordData.isHpk = false;
              keywordData.isRk = true;
              keywordData.rank = parseInt(row['Rank'] || '0') || null;
            }

            // Validate required fields
            if (!keywordData.keyword || keywordData.keyword.trim() === '') {
              results.errors.push({ row: i + 1, error: 'Missing keyword' });
              continue;
            }

            await storage.createKeyword(keywordData);
            results.inserted++;
          } catch (error: any) {
            console.error(`Error inserting keyword at row ${i + 1}:`, error);
            results.errors.push({ 
              row: i + 1, 
              keyword: row['Keyword'], 
              error: error.message 
            });
                }
              }
            }

            // Track upload activity
            await trackUserActivity(
              (req as any).adminUser?.id,
              (req as any).trackingSessionId,
              'csv_upload',
              {
                filename: req.file?.originalname,
                uploadPeriod,
                keywordType,
                totalRows: rows.length,
                inserted: results.inserted,
                errors: results.errors.length
              }
            );

        console.log('File upload completed:', results);
        res.json({
          message: "File upload completed",
          results: {
            totalRows: rows.length,
            inserted: results.inserted,
            errors: results.errors.length,
            errorDetails: results.errors.slice(0, 10) // First 10 errors
          }
        });

    } catch (error: any) {
      console.error("CSV upload error:", error);
      res.status(500).json({ message: "Failed to upload CSV", error: error.message });
    }
  });

  // CSV Upload endpoints removed - Add 410 Gone responses for backward compatibility
  app.post("/api/admin/keywords/upload-csv", isAdmin, (req, res) => {
    res.status(410).json({ 
      message: "CSV upload endpoint removed. Please upload CSV files directly to Supabase using the dashboard." 
    });
  });

  app.post("/api/admin/keywords/upload-hpk", isAdmin, (req, res) => {
    res.status(410).json({ 
      message: "HPK upload endpoint removed. Please upload HPK CSV files directly to Supabase using the dashboard." 
    });
  });

  app.post("/api/admin/keywords/upload-rk", isAdmin, (req, res) => {
    res.status(410).json({ 
      message: "RK upload endpoint removed. Please upload RK CSV files directly to Supabase using the dashboard." 
    });
  });

  // Period endpoints for compatibility
  app.get("/api/admin/uploads", isAdmin, async (req, res) => {
    try {
      res.json({ message: "Upload functionality removed. Use Supabase dashboard for CSV uploads." });
    } catch (error) {
      console.error("Error fetching uploads:", error);
      res.status(500).json({ message: "Failed to fetch uploads" });
    }
  });

  app.get("/api/keywords/hpk-periods", async (req, res) => {
    try {
      const periods = await storage.getAvailableHpkPeriods();
      res.json(periods);
    } catch (error) {
      console.error("Error fetching HPK periods:", error);
      res.status(500).json({ message: "Failed to fetch HPK periods" });
    }
  });

  app.get("/api/keywords/rk-periods", async (req, res) => {
    try {
      const periods = await storage.getAvailableRkPeriods();
      res.json(periods);
    } catch (error) {
      console.error("Error fetching RK periods:", error);
      res.status(500).json({ message: "Failed to fetch RK periods" });
    }
  });

  app.get("/api/keywords/regular-periods", async (req, res) => {
    try {
      const periods = await storage.getAvailableRegularPeriods();
      res.json(periods);
    } catch (error) {
      console.error("Error fetching regular periods:", error);
      res.status(500).json({ message: "Failed to fetch regular periods" });
    }
  });

  // Now I need to add the remaining large routes - Training materials, Ad management
  // Let me continue in the next edit to keep this manageable
  return createServer(app);
}