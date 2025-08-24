/**
 * Date and Time Utility Functions
 * Common utilities for formatting dates and times across the application
 */

/**
 * Format time in 12-hour format (e.g., "02:30 PM")
 * @param {Date} date - The date object to format (defaults to current time)
 * @returns {string} - Formatted time string
 */
const formatTime12Hour = (date = new Date()) => {
  const timeOptions = { 
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  };
  return date.toLocaleTimeString('en-US', timeOptions);
};

/**
 * Format time in 24-hour format (e.g., "14:30")
 * @param {Date} date - The date object to format (defaults to current time)
 * @returns {string} - Formatted time string
 */
const formatTime24Hour = (date = new Date()) => {
  const timeOptions = { 
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  };
  return date.toLocaleTimeString('en-US', timeOptions);
};

/**
 * Format full date and time (e.g., "Monday, January 15, 2024 at 02:30:45 PM")
 * @param {Date} date - The date object to format (defaults to current time)
 * @returns {string} - Formatted date and time string
 */
const formatFullDateTime = (date = new Date()) => {
  const options = { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  };
  return date.toLocaleDateString('en-US', options);
};

/**
 * Format date only (e.g., "January 15, 2024")
 * @param {Date} date - The date object to format (defaults to current date)
 * @returns {string} - Formatted date string
 */
const formatDateOnly = (date = new Date()) => {
  const options = { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric'
  };
  return date.toLocaleDateString('en-US', options);
};

/**
 * Format relative time (e.g., "2 minutes ago", "Just now")
 * @param {Date} date - The date to compare against current time
 * @returns {string} - Relative time string
 */
const formatRelativeTime = (date) => {
  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  const diffInHours = Math.floor(diffInMinutes / 60);
  const diffInDays = Math.floor(diffInHours / 24);
  
  if (diffInSeconds < 60) {
    return 'Just now';
  } else if (diffInMinutes < 60) {
    return `${diffInMinutes}m ago`;
  } else if (diffInHours < 24) {
    return `${diffInHours}h ago`;
  } else if (diffInDays < 7) {
    return `${diffInDays}d ago`;
  } else {
    return formatDateOnly(date);
  }
};

module.exports = {
  formatTime12Hour,
  formatTime24Hour,
  formatFullDateTime,
  formatDateOnly,
  formatRelativeTime
};
