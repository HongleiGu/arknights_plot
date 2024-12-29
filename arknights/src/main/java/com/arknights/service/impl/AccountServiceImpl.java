package com.arknights.service.impl;

import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.arknights.mapper.AccountMapper;
import com.arknights.pojo.Result;
import com.arknights.pojo.User;
import com.arknights.service.AccountService;

@Service
public class AccountServiceImpl implements AccountService{

  @Autowired
  private AccountMapper mapper;

  @Override
  public User login(User user) {
    List<User> userList = mapper.login(user);
    if (userList.size() <= 0) {
      return null;
    }
    else if (userList.size() > 1) {
      return null;
    }
    return userList.get(0);
  }
  
  @Override
  public Boolean register(User user) {
    // 先找存不存在这个用户
    if (mapper.findUsername(user.getUsername()) == 0) {
      mapper.register(user);
      return true;
    }
    return false;
  }
}
