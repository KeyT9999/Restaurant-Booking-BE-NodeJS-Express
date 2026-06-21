'use strict';

const waitlistService = require('../services/waitlist.service');
const waitlistNotifications = require('../services/waitlist-notification.service');

const handleError = (res, error, fallbackMessage) => {
  console.error(`[AdminWaitlist] ${error.message}`);
  return res.status(error.status || 500).json({
    success: false,
    message: error.message || fallbackMessage,
    errors: error.errors,
  });
};

const getWaitlists = async (req, res) => {
  try {
    const data = await waitlistService.getAdminWaitlists(req.query);
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, 'Khong the tai danh sach cho');
  }
};

const getStats = async (req, res) => {
  try {
    const data = await waitlistService.getAdminStats();
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, 'Khong the tai thong ke danh sach cho');
  }
};

const getWaitlistById = async (req, res) => {
  try {
    const waitlist = await waitlistService.getAdminWaitlistDetail(req.params.id);
    return res.json({ success: true, data: { waitlist } });
  } catch (error) {
    return handleError(res, error, 'Khong the tai chi tiet danh sach cho');
  }
};

const updateWaitlistStatus = async (req, res) => {
  try {
    const waitlist = await waitlistService.updateAdminWaitlistStatus(
      req.user._id,
      req.params.id,
      req.body.status,
      req.body.note
    );

    if (waitlist.status === 'cancelled') {
      waitlistNotifications.notifyWaitlistCancelled(req.app.get('io'), waitlist)
        .catch((err) => console.error('[AdminWaitlist] notifyWaitlistCancelled failed:', err.message));
    } else if (waitlist.status === 'expired') {
      waitlistNotifications.notifyWaitlistExpired(req.app.get('io'), waitlist)
        .catch((err) => console.error('[AdminWaitlist] notifyWaitlistExpired failed:', err.message));
    } else {
      waitlistNotifications.notifyWaitlistUpdated(req.app.get('io'), waitlist, 'admin_status_updated')
        .catch((err) => console.error('[AdminWaitlist] notifyWaitlistUpdated failed:', err.message));
    }

    return res.json({
      success: true,
      message: 'Cap nhat trang thai danh sach cho thanh cong',
      data: { waitlist },
    });
  } catch (error) {
    return handleError(res, error, 'Khong the cap nhat trang thai danh sach cho');
  }
};

module.exports = {
  getWaitlists,
  getStats,
  getWaitlistById,
  updateWaitlistStatus,
};
