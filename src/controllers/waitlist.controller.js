'use strict';

const waitlistService = require('../services/waitlist.service');
const waitlistNotifications = require('../services/waitlist-notification.service');

const handleError = (res, error, fallbackMessage) => {
  console.error(`[Waitlist] ${error.message}`);
  return res.status(error.status || 500).json({
    success: false,
    message: error.message || fallbackMessage,
    errors: error.errors,
  });
};

const createWaitlist = async (req, res) => {
  try {
    const waitlist = await waitlistService.createWaitlist(req.user._id, req.body);
    waitlistNotifications.notifyWaitlistCreated(req.app.get('io'), waitlist)
      .catch((err) => console.error('[Waitlist] notifyWaitlistCreated failed:', err.message));

    return res.status(201).json({
      success: true,
      message: 'Da tham gia danh sach cho. Nha hang se thong bao khi co ban trong.',
      data: { waitlist },
    });
  } catch (error) {
    return handleError(res, error, 'Khong the tao yeu cau danh sach cho');
  }
};

const getMyWaitlists = async (req, res) => {
  try {
    const data = await waitlistService.getMyWaitlists(req.user._id, req.query);
    return res.json({ success: true, data });
  } catch (error) {
    return handleError(res, error, 'Khong the tai danh sach cho cua ban');
  }
};

const getWaitlistById = async (req, res) => {
  try {
    const waitlist = await waitlistService.getWaitlistForCustomer(req.params.id, req.user._id);
    return res.json({ success: true, data: { waitlist } });
  } catch (error) {
    return handleError(res, error, 'Khong the tai chi tiet danh sach cho');
  }
};

const updateWaitlist = async (req, res) => {
  try {
    const waitlist = await waitlistService.updateCustomerWaitlist(req.params.id, req.user._id, req.body);
    waitlistNotifications.notifyWaitlistUpdated(req.app.get('io'), waitlist, 'customer_updated')
      .catch((err) => console.error('[Waitlist] notifyWaitlistUpdated failed:', err.message));

    return res.json({
      success: true,
      message: 'Cap nhat danh sach cho thanh cong',
      data: { waitlist },
    });
  } catch (error) {
    return handleError(res, error, 'Khong the cap nhat danh sach cho');
  }
};

const cancelWaitlist = async (req, res) => {
  try {
    const waitlist = await waitlistService.cancelCustomerWaitlist(
      req.params.id,
      req.user._id,
      req.body.reason
    );
    waitlistNotifications.notifyWaitlistCancelled(req.app.get('io'), waitlist)
      .catch((err) => console.error('[Waitlist] notifyWaitlistCancelled failed:', err.message));

    return res.json({
      success: true,
      message: 'Huy danh sach cho thanh cong',
      data: { waitlist },
    });
  } catch (error) {
    return handleError(res, error, 'Khong the huy danh sach cho');
  }
};

module.exports = {
  createWaitlist,
  getMyWaitlists,
  getWaitlistById,
  updateWaitlist,
  cancelWaitlist,
};
